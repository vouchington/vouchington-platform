import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdmissionIdempotency } from './admission-idempotency.mts'
import { canonicalizeAdmissionIntent } from './admission-intent.mts'
import { getAdmissionLockManager } from './admission-lock.mts'
import { startAdmissionOwnerLeaseRenewal } from './admission-owner-renewal.mts'
import { ADMISSION_OWNER_LEASE_MS } from './admission-owner-leases.mts'
import { AdmissionEntryStore } from './admission-storage.mts'
import { parseStoredAdmissionEntry } from './admission-storage-entry.mts'
import { MemoryLockManager, MemoryStorage } from './admission-test-helpers.mts'

const PREFIX = 'ns:admission-idempotency:v1:'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('AdmissionIdempotency defaults', () => {
  it('mints random keys, reports nothing, and keeps anonymous intents in memory', async () => {
    const keys = new AdmissionIdempotency(undefined, { storage: null, lockManager: null })
    const key = await keys.run({ a: 1 }, async (idempotencyKey) => idempotencyKey)
    expect(key).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('canonicalizes without transient fields by default', () => {
    expect(canonicalizeAdmissionIntent({ b: [{ z: 1, y: undefined }], a: 1 })).toBe(
      '{"a":1,"b":[{"z":1}]}',
    )
  })

  it('applies toJSON before sorting so distinct dates stay distinct', () => {
    const first = canonicalizeAdmissionIntent({ at: new Date('2026-01-01T00:00:00Z'), b: 1 })
    const second = canonicalizeAdmissionIntent({ b: 1, at: new Date('2026-02-01T00:00:00Z') })
    expect(first).toBe('{"at":"2026-01-01T00:00:00.000Z","b":1}')
    expect(first).not.toBe(second)
  })

  it('reuses custom, non-UUID keys after a reload', async () => {
    const storage = new MemoryStorage()
    const lockManager = new MemoryLockManager()
    const options = { actorId: 'actor', storage, lockManager }
    const first = new AdmissionIdempotency(() => 'order-123', options)
    await expect(
      first.run({ a: 1 }, async () => {
        throw new Error('retry')
      }),
    ).rejects.toThrow('retry')
    const reloaded = new AdmissionIdempotency(() => 'order-456', options)
    await expect(reloaded.run({ a: 1 }, async (key) => key)).resolves.toBe('order-123')
  })

  it('rejects runs whose actor changed while the intent was being identified', async () => {
    const storage = new MemoryStorage()
    const lockManager = new MemoryLockManager()
    const request = vi.fn(async (key: string) => key)
    for (const next of ['actor-b', null]) {
      const keys = new AdmissionIdempotency(undefined, { actorId: 'actor-a', storage, lockManager })
      const pending = keys.run({ a: 1 }, request)
      keys.setActor(next)
      await expect(pending).rejects.toThrow('Admission actor changed during submission')
    }
    expect(request).not.toHaveBeenCalled()
  })
})

describe('getAdmissionLockManager', () => {
  it('returns null when navigator access throws', () => {
    vi.stubGlobal('navigator', {
      get locks(): never {
        throw new Error('blocked')
      },
    })
    expect(getAdmissionLockManager()).toBeNull()
  })

  it('returns navigator.locks when present', () => {
    const locks = new MemoryLockManager()
    vi.stubGlobal('navigator', { locks })
    expect(getAdmissionLockManager()).toBe(locks)
  })

  it('returns null when navigator has no locks', () => {
    vi.stubGlobal('navigator', {})
    expect(getAdmissionLockManager()).toBeNull()
  })
})

describe('parseStoredAdmissionEntry owners', () => {
  const base = { version: 1, intentFingerprint: 'f', key: crypto.randomUUID(), expiresAt: 5000 }

  it('accepts legacy owner id arrays and rejects non-string ids', () => {
    const accepted = parseStoredAdmissionEntry(JSON.stringify({ ...base, ownerIds: ['a'] }), 1000)
    expect(accepted?.ownerLeases).toEqual({ a: 1000 + ADMISSION_OWNER_LEASE_MS })
    expect(
      parseStoredAdmissionEntry(JSON.stringify({ ...base, ownerIds: [1] }), 1000),
    ).toBeUndefined()
  })

  it('rejects malformed lease and flag fields', () => {
    for (const patch of [
      { ownerLeases: [] },
      { ownerLeases: { a: 'x' } },
      { retryRequired: 'yes' },
      { successObserved: 'yes' },
    ]) {
      expect(parseStoredAdmissionEntry(JSON.stringify({ ...base, ...patch }), 1000)).toBeUndefined()
    }
  })
})

describe('AdmissionEntryStore without usable storage', () => {
  const entry = { intentFingerprint: 'f', key: crypto.randomUUID(), expiresAt: 5000 }

  it('cannot remove or set without storage', () => {
    const store = new AdmissionEntryStore(null, () => 1000, PREFIX)
    expect(store.remove(`${PREFIX}a`)).toBe(false)
    expect(store.set(`${PREFIX}a`, entry)).toBe(false)
    expect(store.remove('other:a')).toBe(false)
    expect(store.get('other:a', 'f')).toBeUndefined()
  })

  it('drops unreadable and invalid entries while pruning', () => {
    const storage = new MemoryStorage()
    storage.setItem(`${PREFIX}broken`, '{not json')
    storage.setItem(`${PREFIX}invalid`, JSON.stringify({ version: 2 }))
    storage.setItem('ns:other', 'kept')
    const store = new AdmissionEntryStore(storage, () => 1000, PREFIX)
    expect(store.set(`${PREFIX}new`, entry)).toBe(true)
    expect([...storage.values.keys()].toSorted()).toEqual([`${PREFIX}new`, 'ns:other'])
  })

  it('fails closed on a throwing getItem without removing the entry', () => {
    const storage = new MemoryStorage()
    storage.setItem(`${PREFIX}a`, JSON.stringify({ version: 1, ...entry, retryRequired: true }))
    vi.spyOn(storage, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    const store = new AdmissionEntryStore(storage, () => 1000, PREFIX)
    expect(store.set(`${PREFIX}b`, entry)).toBe(false)
    expect(() => store.get(`${PREFIX}a`, 'f')).toThrow('denied')
    expect(storage.values.has(`${PREFIX}a`)).toBe(true)
    expect(storage.values.has(`${PREFIX}b`)).toBe(false)
  })

  it('reports false when removal throws', () => {
    const storage = new MemoryStorage()
    vi.spyOn(storage, 'removeItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(new AdmissionEntryStore(storage, () => 1000, PREFIX).remove(`${PREFIX}a`)).toBe(false)
  })
})

describe('startAdmissionOwnerLeaseRenewal', () => {
  const entry = { intentFingerprint: 'f', key: 'k' }
  const storageKey = `${PREFIX}x`

  function setup(current: { key: string } | undefined, lockManager = new MemoryLockManager()) {
    vi.useFakeTimers()
    const store = {
      isDurableKey: (key: string) => key.startsWith(PREFIX),
      get: vi.fn(() => current),
      renew: vi.fn(),
    }
    const onError = vi.fn<(error: unknown) => void>()
    const stop = startAdmissionOwnerLeaseRenewal({
      entry,
      lockManager,
      namespace: 'ns',
      onError,
      ownerId: 'o',
      storageKey,
      store: store as unknown as AdmissionEntryStore,
    })
    return { store, onError, stop }
  }

  it('does nothing for memory keys or without a lock manager', () => {
    const store = { isDurableKey: () => false } as unknown as AdmissionEntryStore
    const base = { entry, namespace: 'ns', onError: vi.fn(), ownerId: 'o', storageKey, store }
    expect(
      startAdmissionOwnerLeaseRenewal({ ...base, lockManager: new MemoryLockManager() })(),
    ).toBe(undefined)
    const durable = { isDurableKey: () => true } as unknown as AdmissionEntryStore
    expect(
      startAdmissionOwnerLeaseRenewal({ ...base, store: durable, lockManager: null })(),
    ).toBeUndefined()
  })

  it('renews the matching entry repeatedly until stopped', async () => {
    const { store, stop } = setup({ key: 'k' })
    await vi.advanceTimersByTimeAsync(ADMISSION_OWNER_LEASE_MS)
    expect(store.renew.mock.calls.length).toBeGreaterThanOrEqual(2)
    stop()
    const calls = store.renew.mock.calls.length
    await vi.advanceTimersByTimeAsync(ADMISSION_OWNER_LEASE_MS)
    expect(store.renew).toHaveBeenCalledTimes(calls)
  })

  it('skips renewal when another entry owns the key or the entry is gone', async () => {
    const other = setup({ key: 'other' })
    await vi.advanceTimersByTimeAsync(ADMISSION_OWNER_LEASE_MS / 3)
    expect(other.store.renew).not.toHaveBeenCalled()
    other.stop()
    const gone = setup(undefined)
    await vi.advanceTimersByTimeAsync(ADMISSION_OWNER_LEASE_MS / 3)
    expect(gone.store.renew).not.toHaveBeenCalled()
    gone.stop()
  })

  it('does not renew when stopped while waiting for the lock', async () => {
    let stop!: () => void
    const lockManager = {
      request: async <T,>(_name: string, callback: () => Promise<T> | T): Promise<T> => {
        stop()
        return callback()
      },
    }
    const state = setup({ key: 'k' }, lockManager as unknown as MemoryLockManager)
    stop = state.stop
    await vi.advanceTimersByTimeAsync(ADMISSION_OWNER_LEASE_MS)
    expect(state.store.get).not.toHaveBeenCalled()
  })

  it('reports lock failures and keeps renewing', async () => {
    const failure = new Error('lock failed')
    const lockManager = { request: vi.fn().mockRejectedValue(failure) }
    const state = setup({ key: 'k' }, lockManager as unknown as MemoryLockManager)
    await vi.advanceTimersByTimeAsync(ADMISSION_OWNER_LEASE_MS)
    expect(state.onError).toHaveBeenCalledWith(failure)
    expect(lockManager.request.mock.calls.length).toBeGreaterThanOrEqual(2)
    state.stop()
  })
})
