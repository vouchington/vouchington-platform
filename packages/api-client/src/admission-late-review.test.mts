import { describe, expect, it, vi } from 'vitest'
import { AdmissionIdempotency } from './admission-idempotency.mts'
import { admissionStoragePrefix } from './admission-lock.mts'
import { ADMISSION_OWNER_LEASE_MS } from './admission-owner-leases.mts'
import { AdmissionEntryStore, MAX_ADMISSION_STORAGE_ENTRIES } from './admission-storage.mts'
import { ADMISSION_RETENTION_MS, parseStoredAdmissionEntry } from './admission-storage-entry.mts'
import { MemoryLockManager, MemoryStorage } from './admission-test-helpers.mts'

const PREFIX = admissionStoragePrefix('vouchington')
const intent = { endpoint: '/api/v1/posts' }

function persisted(storage: MemoryStorage): Record<string, unknown>[] {
  return [...storage.values.values()].map((value) => JSON.parse(value) as Record<string, unknown>)
}

describe('uncertain idempotency keys survive storage read failures', () => {
  it('keeps a retryRequired entry when getItem throws, then replays its key', async () => {
    const storage = new MemoryStorage()
    const lockManager = new MemoryLockManager()
    const key = crypto.randomUUID()
    const first = new AdmissionIdempotency(() => key, { actorId: 'a', lockManager, storage })
    await expect(
      first.run(intent, async () => {
        throw new Error('network')
      }),
    ).rejects.toThrow('network')
    expect(persisted(storage)[0]).toMatchObject({ key, retryRequired: true })

    const getItem = vi.spyOn(storage, 'getItem').mockImplementation(() => {
      throw new Error('transient')
    })
    const second = new AdmissionIdempotency(() => crypto.randomUUID(), {
      actorId: 'a',
      lockManager,
      storage,
    })
    await expect(second.run(intent, async (k) => k)).rejects.toThrow(
      'Durable admission requires writable browser storage',
    )
    expect(persisted(storage)[0]).toMatchObject({ key, retryRequired: true })

    getItem.mockRestore()
    await expect(second.run(intent, async (k) => k)).resolves.toBe(key)
  })

  it('does not drop an entry that cannot be read while pruning', () => {
    const storage = new MemoryStorage()
    const store = new AdmissionEntryStore(storage, () => 1000, PREFIX)
    const entry = { intentFingerprint: 'f', key: 'k', expiresAt: 5000, retryRequired: true }
    expect(store.set(`${PREFIX}a`, entry)).toBe(true)
    vi.spyOn(storage, 'getItem').mockImplementation(() => {
      throw new Error('transient')
    })
    expect(store.set(`${PREFIX}b`, { ...entry, key: 'k2' })).toBe(false)
    expect(storage.values.has(`${PREFIX}a`)).toBe(true)
  })

  it('keeps the entry and reports when the settlement read fails', async () => {
    const storage = new MemoryStorage()
    const onError = vi.fn()
    const keys = new AdmissionIdempotency(() => crypto.randomUUID(), {
      actorId: 'a',
      lockManager: new MemoryLockManager(),
      onError,
      storage,
    })
    await expect(
      keys.run(intent, async () => {
        vi.spyOn(storage, 'getItem').mockImplementation(() => {
          throw new Error('transient')
        })
        throw new Error('network')
      }),
    ).rejects.toThrow('network')
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'transient' }))
    expect(storage.length).toBe(1)
  })
})

describe('settlement after setActor', () => {
  it('marks a failed in-flight entry retryRequired so the identical intent reuses its key', async () => {
    const storage = new MemoryStorage()
    const lockManager = new MemoryLockManager()
    const key = crypto.randomUUID()
    const keys = new AdmissionIdempotency(() => key, { actorId: 'a', lockManager, storage })
    const started = Promise.withResolvers<void>()
    const failure = Promise.withResolvers<string>()
    const settled = keys
      .run(intent, () => {
        started.resolve()
        return failure.promise
      })
      .catch((error: unknown) => error)
    await started.promise
    keys.setActor('b')
    keys.setActor('a')
    failure.reject(new Error('network'))
    expect(await settled).toBeInstanceOf(Error)
    expect(persisted(storage)[0]).toMatchObject({ key, retryRequired: true, ownerLeases: {} })

    await expect(keys.run(intent, async (k) => k)).resolves.toBe(key)
    expect(persisted(storage)).toEqual([])
  })

  it('releases a succeeded in-flight entry after setActor cleared the map', async () => {
    const storage = new MemoryStorage()
    const keys = new AdmissionIdempotency(() => crypto.randomUUID(), {
      actorId: 'a',
      lockManager: new MemoryLockManager(),
      storage,
    })
    const started = Promise.withResolvers<void>()
    const finish = Promise.withResolvers<string>()
    const outcome = keys.run(intent, () => {
      started.resolve()
      return finish.promise
    })
    await started.promise
    keys.setActor('b')
    finish.resolve('done')
    await expect(outcome).resolves.toBe('done')
    expect(persisted(storage)).toEqual([])
  })

  it('settles a memory-only failure without touching the cleared map', async () => {
    const keys = new AdmissionIdempotency(() => crypto.randomUUID(), {
      lockManager: null,
      storage: null,
    })
    const finish = Promise.withResolvers<string>()
    const started = Promise.withResolvers<void>()
    const outcome = keys.run(intent, () => {
      started.resolve()
      return finish.promise
    })
    await started.promise
    keys.setActor('b')
    finish.reject(new Error('network'))
    await expect(outcome).rejects.toThrow('network')
  })

  it('settles a memory-only success', async () => {
    const keys = new AdmissionIdempotency(() => crypto.randomUUID(), {
      lockManager: null,
      storage: null,
    })
    const started = Promise.withResolvers<void>()
    const finish = Promise.withResolvers<string>()
    const outcome = keys.run(intent, () => {
      started.resolve()
      return finish.promise
    })
    await started.promise
    keys.setActor('b')
    finish.resolve('done')
    await expect(outcome).resolves.toBe('done')
  })
})

describe('abandoned owner leases', () => {
  const entry = { intentFingerprint: 'f', key: 'k', expiresAt: ADMISSION_RETENTION_MS }

  it('marks an entry retryRequired when every lease expired without observed success', () => {
    const value = (extra: object) => JSON.stringify({ version: 1, ...entry, ...extra })
    const lease = { ownerLeases: { dead: ADMISSION_OWNER_LEASE_MS } }
    const now = ADMISSION_OWNER_LEASE_MS + 1
    expect(parseStoredAdmissionEntry(value(lease), now)).toMatchObject({ retryRequired: true })
    expect(parseStoredAdmissionEntry(value({ ownerLeases: {} }), now)?.retryRequired).toBe(
      undefined,
    )
    expect(parseStoredAdmissionEntry(value(lease), 1)?.retryRequired).toBe(undefined)
  })

  it('does not evict an abandoned entry under the storage cap', () => {
    let now = 1000
    const storage = new MemoryStorage()
    const store = new AdmissionEntryStore(storage, () => now, PREFIX)
    const abandoned = { intentFingerprint: 'f', key: 'dead', expiresAt: now + 400_000 }
    expect(store.claim(`${PREFIX}abandoned`, abandoned, 'dead-tab')).toBe(true)
    for (let i = 1; i < MAX_ADMISSION_STORAGE_ENTRIES; i += 1)
      expect(
        store.set(`${PREFIX}e${i}`, { ...entry, key: `k${i}`, expiresAt: now + 500_000 + i }),
      ).toBe(true)
    now += ADMISSION_OWNER_LEASE_MS + 1
    expect(store.set(`${PREFIX}new`, { ...entry, key: 'new', expiresAt: now + 900_000 })).toBe(true)
    expect(storage.values.has(`${PREFIX}abandoned`)).toBe(true)
    expect(storage.values.has(`${PREFIX}e1`)).toBe(false)
  })
})
