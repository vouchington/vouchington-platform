import { describe, expect, it, vi } from 'vitest'
import { withResolvers } from './resolvers-test-helpers.mts'
import { AdmissionIdempotency } from './admission-idempotency.mts'
import { getAdmissionLockManager } from './admission-lock.mts'
import { ADMISSION_OWNER_LEASE_MS } from './admission-owner-leases.mts'
import { MemoryLockManager, MemoryStorage } from './admission-test-helpers.mts'

function persistedOwnerCount(storage: MemoryStorage): number {
  const value = [...storage.values.values()][0]
  if (!value) return 0
  const { ownerLeases = {} } = JSON.parse(value) as { ownerLeases?: Record<string, number> }
  return Object.keys(ownerLeases).length
}

describe('AdmissionIdempotency lifecycle', () => {
  it('reuses an anonymous memory key when fingerprinting fails', async () => {
    let next = 0
    const fingerprint = vi
      .fn<(value: string) => Promise<string>>()
      .mockRejectedValue(new Error('Web Crypto unavailable'))
    const keys = new AdmissionIdempotency(() => `key-${++next}`, {
      actorId: null,
      fingerprint,
      lockManager: null,
      storage: null,
    })
    const intent = { endpoint: '/api/v1/posts', body: { markdown: 'Hello' } }

    await expect(
      keys.run(intent, async () => {
        throw new Error('retry')
      }),
    ).rejects.toThrow('retry')
    await expect(keys.run(intent, async (key) => key)).resolves.toBe('key-1')
    expect(fingerprint).toHaveBeenCalledOnce()
  })

  it('does not submit authenticated admissions when fingerprinting fails', async () => {
    let next = 0
    const fingerprint = vi
      .fn<(value: string) => Promise<string>>()
      .mockRejectedValueOnce(new Error('Web Crypto unavailable'))
      .mockResolvedValue('recovered-fingerprint')
    const lockManager = new MemoryLockManager()
    const keys = new AdmissionIdempotency(() => `key-${++next}`, {
      actorId: 'actor-a',
      lockManager,
      fingerprint,
      storage: new MemoryStorage(),
    })
    const intent = { endpoint: '/api/v1/posts', body: { markdown: 'Hello' } }

    const request = vi.fn<(key: string) => Promise<string>>(async (key) => key)
    await expect(keys.run(intent, request)).rejects.toThrow(
      'Durable admission requires browser fingerprinting support',
    )
    await expect(keys.run(intent, request)).rejects.toThrow(
      'Durable admission requires browser fingerprinting support',
    )
    expect(request).not.toHaveBeenCalled()
    expect(fingerprint).toHaveBeenCalledOnce()
  })

  it('allocates one durable key across independent clients', async () => {
    const storage = new MemoryStorage()
    const lockManager = new MemoryLockManager()
    const intent = { endpoint: '/api/v1/posts', body: { markdown: 'Hello' } }
    const firstKey = crypto.randomUUID()
    const secondKey = crypto.randomUUID()
    const first = new AdmissionIdempotency(() => firstKey, {
      actorId: 'actor-a',
      lockManager,
      storage,
    })
    const second = new AdmissionIdempotency(() => secondKey, {
      actorId: 'actor-a',
      lockManager,
      storage,
    })
    let firstObservedKey: string | undefined
    let secondObservedKey: string | undefined
    const started = withResolvers<() => void>()
    const firstRequest = first.run(intent, (key) => {
      firstObservedKey = key
      return new Promise<void>((resolve) => started.resolve(() => resolve())).then(() => key)
    })
    const release = await started.promise

    const secondRequest = second.run(intent, async (key) => {
      secondObservedKey = key
      return key
    })
    await expect(secondRequest).resolves.toBe(firstObservedKey)
    expect(secondObservedKey).toBe(firstObservedKey)
    release()
    await expect(firstRequest).resolves.toBe(firstObservedKey)
    expect([firstKey, secondKey]).toContain(firstObservedKey)
    expect(lockManager.requestedNames).toContain('vouchington:admission-storage:v1')
    expect(
      lockManager.requestedNames.some((name) =>
        name.startsWith('vouchington:admission-allocation:'),
      ),
    ).toBe(true)
  })

  it.each([true, false])(
    'retains a shared key when the winner finishes %s the loser',
    async (winnerFirst) => {
      const storage = new MemoryStorage()
      const lockManager = new MemoryLockManager()
      const firstKey = crypto.randomUUID()
      const intent = { endpoint: '/api/v1/posts', body: { markdown: 'Hello' } }
      const winner = withResolvers<string>()
      const loser = withResolvers<string>()
      const first = new AdmissionIdempotency(() => firstKey, {
        actorId: 'actor-a',
        lockManager,
        storage,
      })
      const second = new AdmissionIdempotency(() => crypto.randomUUID(), {
        actorId: 'actor-a',
        lockManager,
        storage,
      })
      let firstObservedKey: string | undefined
      let secondObservedKey: string | undefined
      const started = [withResolvers<void>(), withResolvers<void>()]
      const firstRequest = first.run(intent, (key) => {
        firstObservedKey = key
        started[0]!.resolve()
        return winner.promise
      })
      const secondRequest = second.run(intent, (key) => {
        secondObservedKey = key
        started[1]!.resolve()
        return loser.promise
      })
      const secondOutcome = secondRequest.then(
        () => ({ error: undefined }),
        (err) => ({ error: err }),
      )

      await Promise.all(started.map((gate) => gate.promise))
      expect(persistedOwnerCount(storage)).toBe(2)
      expect(firstObservedKey).toBe(secondObservedKey)
      const sharedKey = firstObservedKey!
      let firstResult: string | undefined
      let secondError: unknown
      if (winnerFirst) {
        winner.resolve(sharedKey)
        firstResult = await firstRequest
        loser.reject(new Error('in progress'))
        secondError = (await secondOutcome).error
      } else {
        loser.reject(new Error('in progress'))
        secondError = (await secondOutcome).error
        winner.resolve(sharedKey)
        firstResult = await firstRequest
      }
      expect(firstResult).toBe(sharedKey)
      expect(secondError).toEqual(new Error('in progress'))
      expect(storage.length).toBe(1)
      expect([...storage.values.values()][0]).toContain('"retryRequired":true')

      const reloadedKey = crypto.randomUUID()
      const reloaded = new AdmissionIdempotency(() => reloadedKey, {
        actorId: 'actor-a',
        lockManager,
        storage,
      })
      await expect(reloaded.run(intent, async (key) => key)).resolves.toBe(sharedKey)
      expect(storage.length).toBe(0)
    },
  )

  it('removes a durable key after one locked success', async () => {
    const storage = new MemoryStorage()
    const key = crypto.randomUUID()
    const keys = new AdmissionIdempotency(() => key, {
      actorId: 'actor-a',
      lockManager: new MemoryLockManager(),
      storage,
    })
    await expect(keys.run({ endpoint: '/api/v1/posts' }, async (value) => value)).resolves.toBe(key)
    expect(storage.length).toBe(0)
  })

  it('fails closed for durable admission without a lock manager', async () => {
    const storage = new MemoryStorage()
    const key = crypto.randomUUID()
    const intent = { endpoint: '/api/v1/posts' }
    const first = new AdmissionIdempotency(() => key, {
      actorId: 'actor-a',
      lockManager: null,
      storage,
    })
    await expect(first.run(intent, async (value) => value)).rejects.toThrow(
      'Durable admission requires browser Web Locks support',
    )
    const reloadedKey = crypto.randomUUID()
    const reloaded = new AdmissionIdempotency(() => reloadedKey, {
      actorId: 'actor-a',
      lockManager: null,
      storage,
    })
    await expect(reloaded.run(intent, async (value) => value)).rejects.toThrow(
      'Durable admission requires browser Web Locks support',
    )
    expect(storage.length).toBe(0)
  })

  it('uses a fresh key after an abandoned successful owner lease expires', async () => {
    let now = 1000
    const storage = new MemoryStorage()
    const lockManager = new MemoryLockManager()
    const intent = { endpoint: '/api/v1/posts' }
    const firstKey = crypto.randomUUID()
    const recovered = new AdmissionIdempotency(() => crypto.randomUUID(), {
      actorId: 'actor-a',
      lockManager,
      now: () => now,
      storage,
    })
    const abandoned = new AdmissionIdempotency(() => firstKey, {
      actorId: 'actor-a',
      lockManager,
      now: () => now,
      storage,
    })
    const claimed = withResolvers<void>()
    void abandoned.run(intent, () => new Promise<never>(() => claimed.resolve()))
    await claimed.promise
    expect(storage.length).toBe(1)
    await expect(recovered.run(intent, async (key) => key)).resolves.toBe(firstKey)

    now += ADMISSION_OWNER_LEASE_MS + 1
    const freshKey = crypto.randomUUID()
    const intentional = new AdmissionIdempotency(() => freshKey, {
      actorId: 'actor-a',
      lockManager,
      now: () => now,
      storage,
    })
    await expect(intentional.run(intent, async (key) => key)).resolves.toBe(freshKey)
  })

  it('pauses new submissions and drains an active request', async () => {
    const keys = new AdmissionIdempotency(() => crypto.randomUUID())
    const started = withResolvers<() => void>()
    const active = keys.run(
      { route: 'posts.create', body: { markdown: 'Hello' } },
      () => new Promise<void>((resolve) => started.resolve(() => resolve())),
    )
    const release = await started.promise
    keys.pause()
    await expect(
      keys.run({ route: 'posts.create', body: { markdown: 'Other' } }, async () => {}),
    ).rejects.toThrow('Admission submissions are paused')
    const drained = keys.drain()
    let drainSettled = false
    void drained.then(() => (drainSettled = true))
    await Promise.resolve()
    expect(drainSettled).toBe(false)

    release()
    await expect(active).resolves.toBeUndefined()
    await expect(drained).resolves.toBe(true)
    keys.resume()
  })

  it('bounds draining a stalled request without clearing its retry entry', async () => {
    const keys = new AdmissionIdempotency(() => crypto.randomUUID())
    const started = withResolvers<() => void>()
    const active = keys.run(
      { route: 'posts.create', body: { markdown: 'Hello' } },
      () => new Promise<void>((resolve) => started.resolve(() => resolve())),
    )
    const release = await started.promise

    await expect(keys.drain(1)).resolves.toBe(false)
    release()
    await expect(active).resolves.toBeUndefined()
  })

  it('falls back to an unlocked client when browser lock access throws', () => {
    vi.stubGlobal('navigator', {
      get locks(): never {
        throw new Error('Web Locks unavailable')
      },
    })
    try {
      expect(getAdmissionLockManager()).toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
