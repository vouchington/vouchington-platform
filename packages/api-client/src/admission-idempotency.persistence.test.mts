import { describe, expect, it, vi } from 'vitest'
import { AdmissionIdempotency } from './admission-idempotency.mts'
import { ADMISSION_RETENTION_MS } from './admission-storage-entry.mts'
import { MemoryLockManager, MemoryStorage } from './admission-test-helpers.mts'

describe('AdmissionIdempotency persistence', () => {
  it('reuses a persisted key after a fresh client instance reloads', async () => {
    const storage = new MemoryStorage()
    const lockManager = new MemoryLockManager()
    const intent = {
      endpoint: '/api/v1/posts',
      body: { markdown: 'Private draft text', post_type: 'discussion' },
    }
    const persistedKey = crypto.randomUUID()
    const first = new AdmissionIdempotency(() => persistedKey, {
      storage,
      actorId: 'user-a',
      lockManager,
    })
    await expect(
      first.run(intent, async () => {
        throw new Error('response lost')
      }),
    ).rejects.toThrow('response lost')
    expect(JSON.stringify([...storage.values])).not.toContain('Private draft text')
    expect(JSON.stringify([...storage.values])).not.toContain('/api/v1/posts')

    const reloaded = new AdmissionIdempotency(() => crypto.randomUUID(), {
      storage,
      actorId: 'user-a',
      lockManager,
    })
    await expect(reloaded.run(intent, async (key) => key)).resolves.toBe(persistedKey)
    expect(storage.length).toBe(0)
  })

  it('reuses a persisted key after a bounded backward clock correction', async () => {
    let now = 10 * 60 * 1000
    const storage = new MemoryStorage()
    const lockManager = new MemoryLockManager()
    const intent = { endpoint: '/api/v1/posts', body: { markdown: 'Hello' } }
    const persistedKey = crypto.randomUUID()
    const first = new AdmissionIdempotency(() => persistedKey, {
      actorId: 'user-a',
      now: () => now,
      storage,
      lockManager,
    })
    await expect(
      first.run(intent, async () => {
        throw new Error('response lost')
      }),
    ).rejects.toThrow('response lost')

    now -= 60 * 1000
    const reloaded = new AdmissionIdempotency(() => crypto.randomUUID(), {
      actorId: 'user-a',
      now: () => now,
      storage,
      lockManager,
    })

    await expect(reloaded.run(intent, async (key) => key)).resolves.toBe(persistedKey)
  })

  it('replaces expired and malformed persisted entries', async () => {
    const now = 1000
    const firstKey = crypto.randomUUID()
    const replacementKey = crypto.randomUUID()
    const malformedReplacementKey = crypto.randomUUID()
    const storage = new MemoryStorage()
    const lockManager = new MemoryLockManager()
    const intent = { endpoint: '/api/v1/posts', body: { markdown: 'Hello' } }
    const first = new AdmissionIdempotency(() => firstKey, {
      actorId: 'user-a',
      storage,
      now: () => now,
      lockManager,
    })
    await expect(
      first.run(intent, async () => {
        throw new Error('retry')
      }),
    ).rejects.toThrow('retry')
    const persisted = [...storage.values][0]
    if (!persisted) throw new Error('Expected a persisted admission entry')
    const [storageKey, storedValue] = persisted
    storage.setItem(storageKey, JSON.stringify({ ...JSON.parse(storedValue), expiresAt: now - 1 }))

    const afterExpiry = new AdmissionIdempotency(() => replacementKey, {
      actorId: 'user-a',
      storage,
      now: () => now,
      lockManager,
    })
    await expect(
      afterExpiry.run(intent, async () => {
        throw new Error('retry')
      }),
    ).rejects.toThrow('retry')
    expect([...storage.values.values()][0]).toContain(replacementKey)

    storage.setItem(storageKey, '{not-json')
    const afterMalformed = new AdmissionIdempotency(() => malformedReplacementKey, {
      actorId: 'user-a',
      storage,
      now: () => now,
      lockManager,
    })
    await expect(afterMalformed.run(intent, async (key) => key)).resolves.toBe(
      malformedReplacementKey,
    )
    expect(storage.length).toBe(0)
  })

  it('replaces a persisted key that is not a safe header value', async () => {
    const storage = new MemoryStorage()
    const lockManager = new MemoryLockManager()
    const intent = { endpoint: '/api/v1/posts', body: { markdown: 'Hello' } }
    const first = new AdmissionIdempotency(() => crypto.randomUUID(), {
      actorId: 'actor-a',
      storage,
      lockManager,
    })
    await expect(
      first.run(intent, async () => {
        throw new Error('retry')
      }),
    ).rejects.toThrow('retry')
    const persisted = [...storage.values][0]
    if (!persisted) throw new Error('Expected a persisted admission entry')
    const [storageKey, storedValue] = persisted
    storage.setItem(
      storageKey,
      JSON.stringify({ ...JSON.parse(storedValue), key: 'has whitespace' }),
    )

    const replacementKey = crypto.randomUUID()
    const reloaded = new AdmissionIdempotency(() => replacementKey, {
      actorId: 'actor-a',
      storage,
      lockManager,
    })
    await expect(reloaded.run(intent, async (key) => key)).resolves.toBe(replacementKey)
    expect(storage.length).toBe(0)
  })

  it('does not submit when authenticated browser storage access throws', async () => {
    const lockManager = new MemoryLockManager()
    const unavailableStorage = {
      get length(): number {
        throw new Error('unavailable')
      },
      getItem: vi.fn<(key: string) => string | null>(() => {
        throw new Error('unavailable')
      }),
      setItem: vi.fn<(key: string, value: string) => void>(() => {
        throw new Error('unavailable')
      }),
      removeItem: vi.fn<(key: string) => void>(() => {
        throw new Error('unavailable')
      }),
      key: vi.fn<(index: number) => string | null>(() => {
        throw new Error('unavailable')
      }),
    }
    const keys = new AdmissionIdempotency(() => crypto.randomUUID(), {
      actorId: 'actor-a',
      lockManager,
      storage: unavailableStorage,
    })
    const intent = { endpoint: '/api/v1/posts', body: { markdown: 'Hello' } }

    const request = vi.fn<(key: string) => Promise<string>>(async (key) => key)
    await expect(keys.run(intent, request)).rejects.toThrow(
      'Durable admission requires writable browser storage',
    )
    await expect(keys.run(intent, request)).rejects.toThrow(
      'Durable admission requires writable browser storage',
    )
    expect(request).not.toHaveBeenCalled()
    expect(unavailableStorage.getItem).toHaveBeenCalled()
    expect(unavailableStorage.removeItem).toHaveBeenCalled()
  })

  it('isolates persisted keys by authenticated actor without discarding uncertain retries', async () => {
    const storage = new MemoryStorage()
    const lockManager = new MemoryLockManager()
    const actorAKey = crypto.randomUUID()
    const actorBKey = crypto.randomUUID()
    const intent = { endpoint: '/api/v1/posts', body: { markdown: 'Hello' } }
    const keys = new AdmissionIdempotency(() => actorAKey, {
      actorId: 'actor-a',
      storage,
      lockManager,
    })
    await expect(
      keys.run(intent, async () => {
        throw new Error('retry')
      }),
    ).rejects.toThrow('retry')

    keys.setActor('actor-b')
    expect(storage.length).toBe(1)
    let generatedForActorB = false
    const actorBKeys = new AdmissionIdempotency(
      () => {
        generatedForActorB = true
        return actorBKey
      },
      { actorId: 'actor-b', lockManager, storage },
    )
    await expect(
      actorBKeys.run(intent, async () => {
        throw new Error('retry')
      }),
    ).rejects.toThrow('retry')
    expect(generatedForActorB).toBe(true)
    expect(storage.length).toBe(2)
  })

  it('reuses an uncertain retry key after sign-out and same-actor sign-in', async () => {
    const storage = new MemoryStorage()
    const lockManager = new MemoryLockManager()
    const retryKey = crypto.randomUUID()
    const intent = { endpoint: '/api/v1/posts', body: { markdown: 'Hello' } }
    const keys = new AdmissionIdempotency(() => retryKey, {
      actorId: 'actor-a',
      storage,
      lockManager,
    })
    await expect(
      keys.run(intent, async () => {
        throw new Error('response lost')
      }),
    ).rejects.toThrow('response lost')

    keys.setActor(null)
    keys.setActor('actor-a')

    await expect(keys.run(intent, async (key) => key)).resolves.toBe(retryKey)
    expect(storage.length).toBe(0)
  })

  it('renews key retention when an uncertain request is retried', async () => {
    let now = 1000
    const storage = new MemoryStorage()
    const lockManager = new MemoryLockManager()
    const retryKey = crypto.randomUUID()
    const intent = { endpoint: '/api/v1/posts', body: { markdown: 'Hello' } }
    const keys = new AdmissionIdempotency(() => retryKey, {
      actorId: 'actor-a',
      now: () => now,
      storage,
      lockManager,
    })
    const loseResponse = async () => {
      throw new Error('response lost')
    }

    await expect(keys.run(intent, loseResponse)).rejects.toThrow('response lost')
    const originalExpiry = now + ADMISSION_RETENTION_MS
    now = originalExpiry - 1000
    await expect(keys.run(intent, loseResponse)).rejects.toThrow('response lost')

    now = originalExpiry + 1
    const reloaded = new AdmissionIdempotency(() => crypto.randomUUID(), {
      actorId: 'actor-a',
      now: () => now,
      storage,
      lockManager,
    })
    await expect(reloaded.run(intent, async (key) => key)).resolves.toBe(retryKey)
    expect(storage.length).toBe(0)
  })
})
