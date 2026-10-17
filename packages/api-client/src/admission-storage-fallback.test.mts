import { describe, expect, it, vi } from 'vitest'
import { AdmissionIdempotency } from './admission-idempotency.mts'
import { MemoryLockManager, MemoryStorage } from './admission-test-helpers.mts'

describe('AdmissionIdempotency storage fallback', () => {
  it('does not submit when authenticated browser storage writes reject', async () => {
    const storage = new MemoryStorage()
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    const lockManager = new MemoryLockManager()
    const firstKey = crypto.randomUUID()
    const secondKey = crypto.randomUUID()
    const intent = { endpoint: '/api/v1/posts', body: { markdown: 'Hello' } }
    const keys = new AdmissionIdempotency(() => firstKey, {
      actorId: 'actor-a',
      lockManager,
      storage,
    })

    const request = vi.fn<(key: string) => Promise<string>>(async (key) => key)
    await expect(keys.run(intent, request)).rejects.toThrow(
      'Durable admission requires writable browser storage',
    )
    expect(request).not.toHaveBeenCalled()
    expect(storage.length).toBe(0)
    const replacement = new AdmissionIdempotency(() => secondKey, {
      actorId: 'actor-a',
      lockManager,
      storage,
    })
    await expect(keys.run(intent, request)).rejects.toThrow(
      'Durable admission requires writable browser storage',
    )
    await expect(replacement.run(intent, request)).rejects.toThrow(
      'Durable admission requires writable browser storage',
    )
    expect(request).not.toHaveBeenCalled()
  })

  it('does not submit when authenticated storage is unavailable', async () => {
    const lockManager = new MemoryLockManager()
    const key = crypto.randomUUID()
    const keys = new AdmissionIdempotency(() => key, {
      actorId: 'actor-a',
      lockManager,
      storage: null,
    })
    const intent = { endpoint: '/api/v1/posts', body: { markdown: 'Hello' } }

    const request = vi.fn<(value: string) => Promise<string>>(async (value) => value)
    await expect(keys.run(intent, request)).rejects.toThrow(
      'Durable admission requires writable browser storage',
    )
    await expect(keys.run(intent, request)).rejects.toThrow(
      'Durable admission requires writable browser storage',
    )
    expect(request).not.toHaveBeenCalled()
  })

  it('does not submit when persisting the ownership claim fails', async () => {
    const storage = new MemoryStorage()
    let writeCount = 0
    vi.spyOn(storage, 'setItem').mockImplementation((key, value) => {
      writeCount += 1
      if (writeCount === 2) throw new Error('claim persistence rejected')
      storage.values.set(key, value)
    })
    const keys = new AdmissionIdempotency(() => crypto.randomUUID(), {
      actorId: 'actor-a',
      lockManager: new MemoryLockManager(),
      storage,
    })
    const request = vi.fn<(key: string) => Promise<string>>(async (key) => key)

    await expect(
      keys.run({ endpoint: '/api/v1/posts', body: { markdown: 'Hello' } }, request),
    ).rejects.toThrow('Durable admission requires writable browser storage')
    expect(request).not.toHaveBeenCalled()
    expect(writeCount).toBe(2)
  })

  it('retains the key in memory when failure settlement cannot be persisted', async () => {
    const storage = new MemoryStorage()
    let rejectWrites = false
    vi.spyOn(storage, 'setItem').mockImplementation((key, value) => {
      if (rejectWrites) throw new Error('settlement persistence rejected')
      storage.values.set(key, value)
    })
    const lockManager = new MemoryLockManager()
    const key = crypto.randomUUID()
    const intent = { endpoint: '/api/v1/posts', body: { markdown: 'Hello' } }
    const keys = new AdmissionIdempotency(() => key, {
      actorId: 'actor-a',
      lockManager,
      storage,
    })

    await expect(
      keys.run(intent, async () => {
        rejectWrites = true
        throw new Error('response lost')
      }),
    ).rejects.toThrow('response lost')

    rejectWrites = false
    await expect(keys.run(intent, async (observedKey) => observedKey)).resolves.toBe(key)
  })

  it('uses a success tombstone when durable cleanup is rejected', async () => {
    const storage = new MemoryStorage()
    vi.spyOn(storage, 'removeItem').mockImplementation(() => {
      throw new Error('cleanup rejected')
    })
    const lockManager = new MemoryLockManager()
    const firstKey = crypto.randomUUID()
    const secondKey = crypto.randomUUID()
    const intent = { endpoint: '/api/v1/posts', body: { markdown: 'Hello' } }
    const first = new AdmissionIdempotency(() => firstKey, {
      actorId: 'actor-a',
      lockManager,
      storage,
    })
    await expect(first.run(intent, async (key) => key)).resolves.toBe(firstKey)
    expect([...storage.values.values()][0]).toContain('"successObserved":true')

    const second = new AdmissionIdempotency(() => secondKey, {
      actorId: 'actor-a',
      lockManager,
      storage,
    })
    await expect(second.run(intent, async (key) => key)).resolves.toBe(secondKey)
  })
})
