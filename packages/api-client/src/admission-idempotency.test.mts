import { describe, expect, it, vi } from 'vitest'
import { withResolvers } from './resolvers-test-helpers.mts'
import { AdmissionIdempotency } from './admission-idempotency.mts'
import { fingerprintAdmissionIntent } from './admission-intent.mts'

describe('AdmissionIdempotency basic behavior', () => {
  it('reuses a key for an unchanged intent until a request succeeds', async () => {
    let next = 0
    const keys = new AdmissionIdempotency(() => `key-${++next}`)
    const intent = { route: 'posts.create', body: { markdown: 'Hello', post_type: 'discussion' } }

    await expect(
      keys.run(intent, async () => {
        throw new Error('retry')
      }),
    ).rejects.toThrow('retry')
    await expect(
      keys.run(
        { route: 'posts.create', body: { post_type: 'discussion', markdown: 'Hello' } },
        async (key) => key,
      ),
    ).resolves.toBe('key-1')

    await expect(keys.run(intent, async (key) => key)).resolves.toBe('key-2')
  })

  it('shares one execution between overlapping callers', async () => {
    let next = 0
    let fingerprints = 0
    const bothIdentified = withResolvers<void>()
    const keys = new AdmissionIdempotency(() => `key-${++next}`, {
      fingerprint: async (value) => {
        const digest = await fingerprintAdmissionIntent(value)
        fingerprints += 1
        if (fingerprints === 2) bothIdentified.resolve()
        return digest
      },
    })
    const intent = { route: 'posts.create', body: { markdown: 'Hello' } }
    let resolveRequest!: () => void
    const request = vi.fn<(key: string) => Promise<string>>(
      (key: string) => new Promise<string>((resolve) => (resolveRequest = () => resolve(key))),
    )

    const first = keys.run(intent, request)
    const second = keys.run(intent, request)

    await bothIdentified.promise
    await Promise.resolve()
    await Promise.resolve()
    expect(request).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledWith('key-1')
    resolveRequest()
    await expect(first).resolves.toBe('key-1')
    await expect(second).resolves.toBe('key-1')
    await expect(keys.run(intent, async (key) => key)).resolves.toBe('key-2')
  })

  it('ignores refreshed challenge and honeypot material', async () => {
    let next = 0
    const keys = new AdmissionIdempotency(() => `key-${++next}`, {
      transientFields: ['cf_turnstile_response', 'recaptcha_token', 'hp_website'],
    })

    await expect(
      keys.run(
        {
          route: 'posts.create',
          body: { markdown: 'Hello', cf_turnstile_response: 'first', recaptcha_token: 'first' },
        },
        async () => {
          throw new Error('retry')
        },
      ),
    ).rejects.toThrow('retry')
    await expect(
      keys.run(
        {
          route: 'posts.create',
          body: {
            markdown: 'Hello',
            cf_turnstile_response: 'second',
            recaptcha_token: 'second',
            hp_website: '',
          },
        },
        async (key) => key,
      ),
    ).resolves.toBe('key-1')
  })

  it('uses a fresh key when canonical intent changes', async () => {
    let next = 0
    const keys = new AdmissionIdempotency(() => `key-${++next}`)
    const firstIntent = { route: 'posts.create', body: { markdown: 'First' } }
    const secondIntent = { route: 'posts.create', body: { markdown: 'Second' } }

    await expect(
      keys.run(firstIntent, async () => {
        throw new Error('retry first')
      }),
    ).rejects.toThrow('retry first')
    await expect(
      keys.run(secondIntent, async (key) => {
        expect(key).toBe('key-2')
        throw new Error('retry second')
      }),
    ).rejects.toThrow('retry second')

    await expect(keys.run(firstIntent, async (key) => key)).resolves.toBe('key-1')
    await expect(keys.run(secondIntent, async (key) => key)).resolves.toBe('key-2')
  })
})
