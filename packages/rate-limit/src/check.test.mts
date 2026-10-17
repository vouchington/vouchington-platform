import { createHash } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import { chargeRoutes } from './charge.mts'
import { createRouteRateLimiter } from './check.mts'
import { applyRateLimitResult } from './headers.mts'
import { buildRateLimitKeys, sanitizeRouteKeySegment } from './keys.mts'
import type { RateLimitBackend, RouteRateLimitResult } from './types.mts'

function fakeBackend(
  impl: RateLimitBackend['addAndCheck'] = async (ids) => ({
    counts: ids.map(() => 1),
    limited: false,
  }),
) {
  return { addAndCheck: vi.fn(impl) }
}

describe('buildRateLimitKeys', () => {
  it('sanitizes the route and keeps identity order, skipping empty values', () => {
    expect(sanitizeRouteKeySegment('GET:/a {b}')).toBe('GET:/a__b_')
    expect(
      buildRateLimitKeys('GET:/x', { ip: '1.1.1.1', did: undefined, uid: '', sid: 's1' }),
    ).toEqual(['ip:1.1.1.1:GET:/x', 'sid:s1:GET:/x'])
  })

  it('hashes only the configured dimensions', () => {
    const hash = createHash('sha256').update('a@b.c').digest('hex').slice(0, 16)
    expect(
      buildRateLimitKeys(
        'r',
        { ip: '1', email: 'a@b.c' },
        { hashedDimensions: new Set(['email']) },
      ),
    ).toEqual(['ip:1:r', `email:${hash}:r`])
  })
})

describe('createRouteRateLimiter', () => {
  const policy = { threshold: 10, ttlSeconds: 60 }

  it('charges all identities and reports remaining from the highest count', async () => {
    const backend = fakeBackend(async () => ({ counts: [3, 7], limited: false }))
    const resolvePolicy = vi.fn(() => policy)
    const check = createRouteRateLimiter<string>({ getBackend: () => backend, resolvePolicy })
    await expect(check('r', { ip: '1', uid: 'u' }, 'ctx')).resolves.toEqual({
      limited: false,
      retryAfterSeconds: 60,
      limit: 10,
      remaining: 3,
    })
    expect(backend.addAndCheck).toHaveBeenCalledWith(['ip:1:r', 'uid:u:r'], 10, 60)
    expect(resolvePolicy).toHaveBeenCalledWith('r', { ip: '1', uid: 'u' }, 'ctx')
  })

  it('reports limited and treats empty counts as zero', async () => {
    const limited = createRouteRateLimiter({
      getBackend: () => fakeBackend(async () => ({ counts: [10], limited: true })),
      resolvePolicy: async () => policy,
    })
    expect(await limited('r', { ip: '1' }, undefined)).toMatchObject({
      limited: true,
      remaining: 0,
    })
    const empty = createRouteRateLimiter({
      getBackend: () => fakeBackend(async () => ({ counts: [], limited: false })),
      resolvePolicy: () => policy,
    })
    expect(await empty('r', { ip: '1' }, undefined)).toMatchObject({ remaining: 10 })
  })

  it('skips the backend when there are no identities', async () => {
    const getBackend = vi.fn()
    const check = createRouteRateLimiter({ getBackend, resolvePolicy: () => policy })
    expect(await check('r', {}, undefined)).toEqual({
      limited: false,
      retryAfterSeconds: 0,
      limit: 10,
      remaining: 10,
    })
    expect(getBackend).not.toHaveBeenCalled()
  })

  it('fails open by default and wraps non-Error failures', async () => {
    const onError = vi.fn()
    const check = createRouteRateLimiter({
      getBackend: () =>
        fakeBackend(async () => {
          throw 'down'
        }),
      resolvePolicy: () => policy,
      onError,
    })
    expect(await check('r', { ip: '1' }, undefined)).toEqual({
      limited: false,
      retryAfterSeconds: 0,
      limit: 10,
      remaining: 10,
    })
    expect(onError).toHaveBeenCalledWith(new Error('down'))
  })

  it('fails closed when the policy asks, passing Error instances through', async () => {
    const boom = new Error('boom')
    const onError = vi.fn()
    const check = createRouteRateLimiter({
      getBackend: () =>
        fakeBackend(async () => {
          throw boom
        }),
      resolvePolicy: () => ({ ...policy, failClosed: true }),
      onError,
    })
    expect(await check('r', { ip: '1' }, undefined)).toEqual({
      limited: true,
      retryAfterSeconds: 60,
      limit: 10,
      remaining: 0,
    })
    expect(onError).toHaveBeenCalledWith(boom)
  })

  it('tolerates a missing onError', async () => {
    const check = createRouteRateLimiter({
      getBackend: () =>
        fakeBackend(async () => {
          throw new Error('x')
        }),
      resolvePolicy: () => policy,
    })
    expect((await check('r', { ip: '1' }, undefined)).limited).toBe(false)
  })
})

describe('applyRateLimitResult', () => {
  const ctx = () => ({
    set: vi.fn(),
    throw: vi.fn((): never => {
      throw new Error('429')
    }),
  })
  const result = (over: Partial<RouteRateLimitResult>): RouteRateLimitResult => ({
    limited: false,
    retryAfterSeconds: 0,
    limit: 5,
    remaining: 4,
    ...over,
  })

  it('sets headers for a limited route without throwing when allowed', () => {
    const c = ctx()
    applyRateLimitResult(c, result({}))
    expect(c.set.mock.calls).toEqual([
      ['X-RateLimit-Limit', '5'],
      ['X-RateLimit-Remaining', '4'],
    ])
    expect(c.throw).not.toHaveBeenCalled()
  })

  it('sets no headers when the route has no limit', () => {
    const c = ctx()
    applyRateLimitResult(c, result({ limit: 0 }))
    expect(c.set).not.toHaveBeenCalled()
  })

  it('throws 429 with Retry-After and an overridable message', () => {
    const c = ctx()
    expect(() => applyRateLimitResult(c, result({ limited: true, retryAfterSeconds: 30 }))).toThrow(
      '429',
    )
    expect(c.set).toHaveBeenCalledWith('Retry-After', '30')
    expect(c.throw).toHaveBeenCalledWith(429, 'Rate limit exceeded. Please try again later.')
    expect(() =>
      applyRateLimitResult(c, result({ limited: true }), { message: 'slow down' }),
    ).toThrow()
    expect(c.throw).toHaveBeenLastCalledWith(429, 'slow down')
  })
})

describe('chargeRoutes', () => {
  it('charges in order and stops a unit at its first spent route', async () => {
    const seen: string[] = []
    const refused = await chargeRoutes(
      [
        { index: 0, routeKeys: ['a', 'b'] },
        { index: 1, routeKeys: ['a', 'c', 'd'] },
        { index: 2, routeKeys: [] },
      ],
      async (routeKey) => {
        seen.push(routeKey)
        return { limited: routeKey === 'c', retryAfterSeconds: 9, limit: 1, remaining: 0 }
      },
    )
    expect(seen).toEqual(['a', 'b', 'a', 'c'])
    expect([...refused]).toEqual([[1, 9]])
  })
})
