import { afterEach, describe, expect, it, vi } from 'vitest'
import { withResolvers } from './resolvers-test-helpers.mts'
import { AdmissionIdempotency } from './admission-idempotency.mts'
import { ADMISSION_OWNER_LEASE_MS } from './admission-owner-leases.mts'
import { AdmissionEntryStore } from './admission-storage.mts'
import { MemoryLockManager, MemoryStorage } from './admission-test-helpers.mts'

afterEach(() => {
  vi.useRealTimers()
})

const intent = { route: 'posts.create' }

function durable(options: ConstructorParameters<typeof AdmissionIdempotency>[1] = {}) {
  const storage = new MemoryStorage()
  const lockManager = new MemoryLockManager()
  const keys = new AdmissionIdempotency(() => crypto.randomUUID(), {
    actorId: 'actor',
    lockManager,
    storage,
    ...options,
  })
  return { keys, storage, lockManager }
}

describe('AdmissionIdempotency settlement edge cases', () => {
  it('ignores a repeated actor and drops entries when the actor changes mid-flight', async () => {
    const { keys } = durable()
    keys.setActor('actor')
    let finish!: (value: string) => void
    const pending = keys.run(intent, () => new Promise<string>((resolve) => (finish = resolve)))
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    keys.setActor('someone-else')
    finish('done')
    await expect(pending).resolves.toBe('done')
  })

  it('skips failure bookkeeping when the actor changes mid-flight', async () => {
    const { keys } = durable()
    let fail!: (error: Error) => void
    const pending = keys.run(intent, () => new Promise<string>((_, reject) => (fail = reject)))
    await vi.waitFor(() => expect(fail).toBeTypeOf('function'))
    keys.setActor(null)
    fail(new Error('late failure'))
    await expect(pending).rejects.toThrow('late failure')
  })

  it('keeps retrying with a fresh in-memory entry when the persisted entry vanished', async () => {
    const { keys, storage } = durable()
    await expect(
      keys.run(intent, async () => {
        storage.values.clear()
        throw new Error('failed')
      }),
    ).rejects.toThrow('failed')
    await expect(keys.run(intent, async (key) => key)).resolves.toMatch(/^[0-9a-f-]{36}$/)
  })

  it('reports owner renewal failures to the injected reporter and survives without one', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const failure = new Error('lock broke')
    let broken = false
    const memory = new MemoryLockManager()
    const lockManager = {
      request: async <T,>(name: string, callback: () => Promise<T> | T): Promise<T> => {
        if (broken) throw failure
        return memory.request(name, callback)
      },
    }
    const onError = vi.fn<(error: unknown) => void>()
    for (const reporter of [onError, undefined]) {
      broken = false
      const keys = new AdmissionIdempotency(() => crypto.randomUUID(), {
        actorId: 'actor',
        lockManager,
        storage: new MemoryStorage(),
        ...(reporter ? { onError: reporter } : {}),
      })
      const started = withResolvers<void>()
      const pending = keys.run(intent, () => {
        started.resolve()
        return new Promise<string>(() => {})
      })
      pending.catch(() => {})
      await started.promise
      broken = true
      await vi.advanceTimersByTimeAsync(ADMISSION_OWNER_LEASE_MS)
    }
    expect(onError).toHaveBeenCalledWith(failure)
  })
})

describe('AdmissionEntryStore listing', () => {
  it('prunes keys whose item disappeared between listing and reading', () => {
    const storage = new MemoryStorage()
    const prefix = 'ns:admission-idempotency:v1:'
    storage.setItem(`${prefix}ghost`, 'x')
    vi.spyOn(storage, 'getItem').mockReturnValue(null)
    const store = new AdmissionEntryStore(storage, () => 1000, prefix)
    const entry = { intentFingerprint: 'f', key: crypto.randomUUID(), expiresAt: 5000 }
    expect(store.set(`${prefix}new`, entry)).toBe(true)
    expect(storage.values.has(`${prefix}ghost`)).toBe(false)
  })
})
