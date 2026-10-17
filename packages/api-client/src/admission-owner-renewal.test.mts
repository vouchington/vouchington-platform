import { describe, expect, it, vi } from 'vitest'
import { withResolvers } from './resolvers-test-helpers.mts'
import { AdmissionIdempotency } from './admission-idempotency.mts'
import { ADMISSION_OWNER_LEASE_MS } from './admission-owner-leases.mts'
import { MemoryLockManager, MemoryStorage } from './admission-test-helpers.mts'

function deferred<T>(): {
  promise: Promise<T>
  reject: (reason?: unknown) => void
  resolve: (value: T) => void
} {
  let reject!: (reason?: unknown) => void
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    reject = rejectPromise
    resolve = resolvePromise
  })
  return { promise, reject, resolve }
}

function persistedOwnerLeases(storage: MemoryStorage): Record<string, number> {
  const value = [...storage.values.values()][0]
  if (!value) return {}
  return (JSON.parse(value) as { ownerLeases?: Record<string, number> }).ownerLeases ?? {}
}

describe('admission idempotency owner renewal', () => {
  it('renews a live peer owner before its lease expires', async () => {
    vi.useFakeTimers()
    try {
      const storage = new MemoryStorage()
      const lockManager = new MemoryLockManager()
      const key = crypto.randomUUID()
      const intent = { endpoint: '/api/v1/posts', body: { markdown: 'Hello' } }
      const winner = deferred<string>()
      const loser = deferred<string>()
      const firstStarted = withResolvers<void>()
      const secondStarted = withResolvers<void>()
      const first = new AdmissionIdempotency(() => key, {
        actorId: 'actor-a',
        lockManager,
        storage,
      })
      const second = new AdmissionIdempotency(() => crypto.randomUUID(), {
        actorId: 'actor-a',
        lockManager,
        storage,
      })
      const firstRequest = first.run(intent, () => {
        firstStarted.resolve()
        return winner.promise
      })
      const secondRequest = second.run(intent, () => {
        secondStarted.resolve()
        return loser.promise
      })
      const secondRejection = secondRequest.catch((err: unknown) => err)
      await Promise.all([firstStarted.promise, secondStarted.promise])
      expect(Object.keys(persistedOwnerLeases(storage))).toHaveLength(2)

      await vi.advanceTimersByTimeAsync(ADMISSION_OWNER_LEASE_MS + 1)
      const renewedLeases = Object.values(persistedOwnerLeases(storage))
      expect(renewedLeases).toHaveLength(2)
      expect(Math.min(...renewedLeases)).toBeGreaterThan(Date.now())
      winner.resolve(key)
      await expect(firstRequest).resolves.toBe(key)
      expect(Object.keys(persistedOwnerLeases(storage))).toHaveLength(1)

      loser.reject(new Error('response lost'))
      await expect(secondRejection).resolves.toMatchObject({ message: 'response lost' })
      expect(Object.keys(persistedOwnerLeases(storage))).toHaveLength(0)
      expect([...storage.values.values()][0]).toContain('"retryRequired":true')
    } finally {
      vi.useRealTimers()
    }
  })
})
