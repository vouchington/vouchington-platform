import { describe, expect, it } from 'vitest'
import { withResolvers } from './resolvers-test-helpers.mts'
import { AdmissionIdempotency } from './admission-idempotency.mts'
import { ADMISSION_OWNER_LEASE_MS } from './admission-owner-leases.mts'
import { MemoryLockManager, MemoryStorage } from './admission-test-helpers.mts'

function makeDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

describe('AdmissionIdempotency stale settlement', () => {
  it.each(['successful', 'failed'] as const)(
    'does not let a stale %s attempt settle a newer persisted entry',
    async (outcome) => {
      let now = 1000
      const storage = new MemoryStorage()
      const lockManager = new MemoryLockManager()
      const intent = { endpoint: '/api/v1/posts' }
      const staleKey = crypto.randomUUID()
      const staleRequest = makeDeferred<string>()
      const staleClaimed = withResolvers<void>()
      const stale = new AdmissionIdempotency(() => staleKey, {
        actorId: 'actor-a',
        lockManager,
        now: () => now,
        storage,
      })
      const staleOutcome = stale
        .run(intent, () => {
          staleClaimed.resolve()
          return staleRequest.promise
        })
        .then(
          (value) => ({ value }),
          (err) => ({ error: err }),
        )
      await staleClaimed.promise
      expect(storage.length).toBe(1)

      now += ADMISSION_OWNER_LEASE_MS + 1
      const replay = new AdmissionIdempotency(() => crypto.randomUUID(), {
        actorId: 'actor-a',
        lockManager,
        now: () => now,
        storage,
      })
      await expect(replay.run(intent, async (key) => key)).resolves.toBe(staleKey)

      const freshKey = crypto.randomUUID()
      const freshRequest = makeDeferred<void>()
      const freshClaimed = withResolvers<void>()
      const fresh = new AdmissionIdempotency(() => freshKey, {
        actorId: 'actor-a',
        lockManager,
        now: () => now,
        storage,
      })
      const freshOutcome = fresh.run(intent, () => {
        freshClaimed.resolve()
        return freshRequest.promise
      })
      await freshClaimed.promise
      expect([...storage.values.values()][0]).toContain(freshKey)
      const persistedFreshEntry = [...storage.values.values()][0]

      if (outcome === 'successful') staleRequest.resolve(staleKey)
      else staleRequest.reject(new Error('stale request failed'))
      await staleOutcome

      expect([...storage.values.values()][0]).toBe(persistedFreshEntry)
      await expect(stale.run(intent, async (key) => key)).resolves.toBe(freshKey)
      freshRequest.resolve()
      await freshOutcome
    },
  )
})
