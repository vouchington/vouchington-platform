import { describe, expect, it, vi } from 'vitest'
import { withResolvers } from './resolvers-test-helpers.mts'
import { AdmissionIdempotency } from './admission-idempotency.mts'
import {
  AdmissionEntryStore,
  getAdmissionStorage,
  MAX_ADMISSION_STORAGE_ENTRIES,
} from './admission-storage.mts'
import { ADMISSION_RETENTION_MS, type AdmissionStoredEntry } from './admission-storage-entry.mts'
import { admissionStoragePrefix } from './admission-lock.mts'
import { MemoryLockManager, MemoryStorage } from './admission-test-helpers.mts'

const NOW = 1000
const ADMISSION_STORAGE_PREFIX = admissionStoragePrefix('vouchington')

describe('AdmissionEntryStore bounded persistence', () => {
  it('falls back when browser storage access throws', () => {
    const localStorage = vi.spyOn(globalThis, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('Storage access rejected')
    })
    try {
      expect(getAdmissionStorage()).toBeNull()
    } finally {
      localStorage.mockRestore()
    }
  })

  it('prunes invalid entries before evicting the earliest inactive entry', () => {
    const storage = new MemoryStorage()
    const store = new AdmissionEntryStore(storage, () => NOW, ADMISSION_STORAGE_PREFIX)
    const oldestKey = storageKey('oldest')
    for (let index = 0; index < MAX_ADMISSION_STORAGE_ENTRIES; index++) {
      const key = index === 0 ? oldestKey : storageKey(`retained-${index}`)
      writeStoredEntry(storage, key, {
        intentFingerprint: `retained-${index}`,
        key: crypto.randomUUID(),
        expiresAt: NOW + ADMISSION_RETENTION_MS - MAX_ADMISSION_STORAGE_ENTRIES + index,
      })
    }
    const expiredKey = storageKey('expired')
    writeStoredEntry(storage, expiredKey, {
      intentFingerprint: 'expired',
      key: crypto.randomUUID(),
      expiresAt: NOW - 1,
    })
    const malformedKey = storageKey('malformed')
    storage.setItem(malformedKey, '{not-json')
    const newestKey = storageKey('newest')
    const newestEntry = {
      intentFingerprint: 'newest',
      key: crypto.randomUUID(),
      expiresAt: NOW + ADMISSION_RETENTION_MS,
    }

    store.set(newestKey, newestEntry)

    expect(storage.length).toBe(MAX_ADMISSION_STORAGE_ENTRIES)
    expect(storage.getItem(expiredKey)).toBeNull()
    expect(storage.getItem(malformedKey)).toBeNull()
    expect(storage.getItem(oldestKey)).toBeNull()
    expect(store.get(newestKey, newestEntry.intentFingerprint)).toEqual(newestEntry)
  })

  it('does not discard cross-tab active entries when the store has no evictable capacity', () => {
    const storage = new MemoryStorage()
    const store = new AdmissionEntryStore(storage, () => NOW, ADMISSION_STORAGE_PREFIX)
    for (let index = 0; index < MAX_ADMISSION_STORAGE_ENTRIES; index++) {
      const key = storageKey(`active-${index}`)
      writeStoredEntry(storage, key, {
        intentFingerprint: `active-${index}`,
        key: crypto.randomUUID(),
        expiresAt: NOW + ADMISSION_RETENTION_MS,
        ownerLeases: { [`owner-${index}`]: NOW + 10_000 },
      })
    }
    const nextKey = storageKey('next')
    const nextEntry = {
      intentFingerprint: 'next',
      key: crypto.randomUUID(),
      expiresAt: NOW + ADMISSION_RETENTION_MS,
    }

    store.set(nextKey, nextEntry)

    expect(storage.length).toBe(MAX_ADMISSION_STORAGE_ENTRIES)
    expect(store.get(nextKey, nextEntry.intentFingerprint)).toBeUndefined()
    expect(
      Array.from({ length: MAX_ADMISSION_STORAGE_ENTRIES }, (_, index) =>
        storage.getItem(storageKey(`active-${index}`)),
      ).every(Boolean),
    ).toBe(true)
  })

  it('fails closed rather than evicting uncertain retry entries', async () => {
    const storage = new MemoryStorage()
    const retainedKeys = Array.from({ length: MAX_ADMISSION_STORAGE_ENTRIES }, (_, index) => {
      const key = storageKey(`retry-required-${index}`)
      writeStoredEntry(storage, key, {
        intentFingerprint: `retry-required-${index}`,
        key: crypto.randomUUID(),
        expiresAt: NOW + ADMISSION_RETENTION_MS,
        retryRequired: true,
      })
      return key
    })
    const request = vi.fn<(key: string) => Promise<void>>(async () => undefined)
    const idempotency = new AdmissionIdempotency(() => crypto.randomUUID(), {
      actorId: 'actor-a',
      fingerprint: async (value) => value,
      lockManager: new MemoryLockManager(),
      now: () => NOW,
      storage,
    })

    await expect(idempotency.run({ route: 'next' }, request)).rejects.toThrow(
      'Durable admission requires writable browser storage',
    )
    expect(request).not.toHaveBeenCalled()
    expect(retainedKeys.every((key) => storage.getItem(key) !== null)).toBe(true)
    expect(storage.length).toBe(MAX_ADMISSION_STORAGE_ENTRIES)
  })

  it('continues after browser storage rejects corrupt-entry cleanup', () => {
    const storage = new MemoryStorage()
    const store = new AdmissionEntryStore(storage, () => NOW, ADMISSION_STORAGE_PREFIX)
    const malformedKey = storageKey('malformed')
    storage.setItem(malformedKey, '{not-json')
    const removeItem = vi.spyOn(storage, 'removeItem').mockImplementation(() => {
      throw new Error('Storage cleanup rejected')
    })

    expect(store.get(malformedKey, 'malformed')).toBeUndefined()
    expect(removeItem).toHaveBeenCalledWith(malformedKey)
  })

  it('keeps an active admission durable while pruning inactive retry entries', async () => {
    let now = NOW
    const storage = new MemoryStorage()
    const lockManager = new MemoryLockManager()
    const activeKey = crypto.randomUUID()
    let generated = 0
    const idempotency = new AdmissionIdempotency(
      () => (generated++ === 0 ? activeKey : crypto.randomUUID()),
      {
        actorId: 'actor-a',
        fingerprint: async (value) => value,
        lockManager,
        now: () => now,
        storage,
      },
    )
    let releaseActive!: () => void
    const started = withResolvers<void>()
    const active = idempotency.run(
      { route: 'active' },
      () =>
        new Promise<void>((resolve) => {
          releaseActive = resolve
          started.resolve()
        }),
    )
    await started.promise
    expect(releaseActive).toBeTypeOf('function')
    now += 1
    for (let index = 0; index < MAX_ADMISSION_STORAGE_ENTRIES - 1; index++) {
      writeStoredEntry(storage, storageKey(`inactive-${index}`), {
        intentFingerprint: `inactive-${index}`,
        key: crypto.randomUUID(),
        expiresAt: now + ADMISSION_RETENTION_MS,
      })
    }

    try {
      await expect(
        idempotency.run({ route: 'new' }, async () => {
          throw new Error('response lost')
        }),
      ).rejects.toThrow('response lost')

      expect(storage.length).toBe(MAX_ADMISSION_STORAGE_ENTRIES)
      expect([...storage.values.values()].some((value) => value.includes(activeKey))).toBe(true)
    } finally {
      releaseActive()
      await active
    }
  })

  it('serializes distinct-intent writes through the shared storage-cap lock', async () => {
    const storage = new MemoryStorage()
    for (let index = 0; index < MAX_ADMISSION_STORAGE_ENTRIES; index++) {
      writeStoredEntry(storage, storageKey(`inactive-${index}`), {
        intentFingerprint: `inactive-${index}`,
        key: crypto.randomUUID(),
        expiresAt: NOW + ADMISSION_RETENTION_MS,
      })
    }
    const lockManager = new MemoryLockManager()
    const options = {
      actorId: 'actor-a',
      fingerprint: async (value: string) => value,
      lockManager,
      now: () => NOW,
      storage,
    }
    const first = new AdmissionIdempotency(() => crypto.randomUUID(), options)
    const second = new AdmissionIdempotency(() => crypto.randomUUID(), options)
    let releaseFirst!: () => void
    let releaseSecond!: () => void
    const firstStarted = withResolvers<void>()
    const secondStarted = withResolvers<void>()

    const firstRun = first.run(
      { route: 'first' },
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve
          firstStarted.resolve()
        }),
    )
    const secondRun = second.run(
      { route: 'second' },
      () =>
        new Promise<void>((resolve) => {
          releaseSecond = resolve
          secondStarted.resolve()
        }),
    )
    await Promise.all([firstStarted.promise, secondStarted.promise])
    expect(releaseFirst).toBeTypeOf('function')
    expect(releaseSecond).toBeTypeOf('function')

    expect(
      lockManager.requestedNames.filter((name) => name === 'vouchington:admission-storage:v1'),
    ).toHaveLength(2)
    expect(storage.length).toBe(MAX_ADMISSION_STORAGE_ENTRIES)
    releaseFirst()
    releaseSecond()
    await Promise.all([firstRun, secondRun])
  })
})

function storageKey(suffix: string): string {
  return `${ADMISSION_STORAGE_PREFIX}${suffix}`
}

function writeStoredEntry(storage: MemoryStorage, key: string, entry: AdmissionStoredEntry): void {
  storage.setItem(key, JSON.stringify({ version: 1, ...entry }))
}
