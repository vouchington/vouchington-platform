import { describe, expect, it } from 'vitest'
import { withResolvers } from './resolvers-test-helpers.mts'
import { AdmissionIdempotency } from './admission-idempotency.mts'
import { MemoryLockManager, MemoryStorage } from './admission-test-helpers.mts'

function makeDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('AdmissionIdempotency logout retention', () => {
  it('retains a late successful request key after draining times out', async () => {
    const storage = new MemoryStorage()
    const lockManager = new MemoryLockManager()
    const key = crypto.randomUUID()
    const intent = { route: 'posts.create', body: { markdown: 'Hello' } }
    const response = makeDeferred<string>()
    const claimed = withResolvers<void>()
    const keys = new AdmissionIdempotency(() => key, {
      actorId: 'actor-a',
      lockManager,
      storage,
    })
    const active = keys.run(intent, () => {
      claimed.resolve()
      return response.promise
    })
    await claimed.promise
    expect(storage.length).toBe(1)

    keys.pause()
    await expect(keys.drain(1)).resolves.toBe(false)
    response.resolve('created')
    await expect(active).resolves.toBe('created')

    const persisted = JSON.parse([...storage.values.values()][0]!) as {
      key: string
      ownerLeases?: Record<string, number>
      retryRequired?: boolean
    }
    expect(persisted.key).toBe(key)
    expect(persisted.ownerLeases).toEqual({})
    expect(persisted.retryRequired).toBe(true)

    const reloaded = new AdmissionIdempotency(() => crypto.randomUUID(), {
      actorId: 'actor-a',
      lockManager,
      storage,
    })
    await expect(reloaded.run(intent, async (observedKey) => observedKey)).resolves.toBe(key)
    expect(storage.length).toBe(0)
  })
})
