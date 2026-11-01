import type { Application, Context } from '@jongleberry/api-server'
import { describe, expect, it, vi } from 'vitest'

import { installRouteRateLimit } from './middleware.mts'
import type { RouteRateLimitMiddlewareOptions } from './middleware.mts'
import { withOverlappedRateLimit } from './overlapped.mts'
import type { RouteRateLimitResult } from './types.mts'

const allowed: RouteRateLimitResult = {
  limited: false,
  retryAfterSeconds: 60,
  limit: 5,
  remaining: 4,
}

function setup(overrides: Partial<RouteRateLimitMiddlewareOptions<string>> = {}) {
  let extension: Record<string, unknown> = {}
  const app = { extend: (methods: Record<string, unknown>) => (extension = methods) }
  const resolveIdentities = vi.fn(async () => ({
    identities: { ip: '1.1.1.1' },
    subject: 'user-1',
  }))
  const check = vi.fn(async () => allowed)
  const onSettled = vi.fn()
  const options: RouteRateLimitMiddlewareOptions<string> = {
    resolveIdentities,
    check,
    onSettled,
    ...overrides,
  }
  installRouteRateLimit(app as unknown as Application, options)
  const set = vi.fn()
  const throwFn = vi.fn((): never => {
    throw new Error('429')
  })
  const ctx = { ...extension, set, throw: throwFn } as unknown as Context
  return { ctx, resolveIdentities, check, onSettled, set, throwFn }
}

describe('installRouteRateLimit', () => {
  it('prepares, then settles with headers and the onSettled hook', async () => {
    const { ctx, resolveIdentities, check: checkFn, onSettled, set } = setup()
    const check = await ctx.prepareRouteRateLimit('GET:/x', { email: 'a@b.c' })
    expect(check).toEqual({ result: allowed, subject: 'user-1' })
    expect(resolveIdentities).toHaveBeenCalledWith(ctx, 'GET:/x', { email: 'a@b.c' })
    expect(checkFn).toHaveBeenCalledWith('GET:/x', { ip: '1.1.1.1' }, { ctx, subject: 'user-1' })
    expect(set).not.toHaveBeenCalled()
    await ctx.settleRouteRateLimit('GET:/x', check)
    expect(set).toHaveBeenCalledWith('X-RateLimit-Limit', '5')
    expect(onSettled).toHaveBeenCalledWith(ctx, 'GET:/x', 'user-1')
  })

  it('applyRouteRateLimit prepares and settles in one call', async () => {
    const { ctx, onSettled } = setup()
    await ctx.applyRouteRateLimit('GET:/x')
    expect(onSettled).toHaveBeenCalledWith(ctx, 'GET:/x', 'user-1')
  })

  it('returns null when disabled and settles a null check as a no-op', async () => {
    const { ctx, onSettled, resolveIdentities } = setup({ isEnabled: () => false })
    expect(await ctx.prepareRouteRateLimit('r')).toBeNull()
    await ctx.settleRouteRateLimit('r', null)
    expect(resolveIdentities).not.toHaveBeenCalled()
    expect(onSettled).not.toHaveBeenCalled()
  })

  it('runs when isEnabled is true and works without onSettled', async () => {
    const { ctx } = setup({ isEnabled: () => true, onSettled: undefined })
    await expect(ctx.applyRouteRateLimit('r')).resolves.toBeUndefined()
  })

  it('throws 429 with the configured message before metering', async () => {
    const { ctx, onSettled, throwFn } = setup({
      check: async () => ({ ...allowed, limited: true }),
      message: 'slow down',
    })
    await expect(ctx.applyRouteRateLimit('r')).rejects.toThrow('429')
    expect(throwFn).toHaveBeenCalledWith(429, 'slow down')
    expect(onSettled).not.toHaveBeenCalled()
  })
})

describe('withOverlappedRateLimit', () => {
  it('overlaps the limiter with the load and defers settlement', async () => {
    const order: string[] = []
    const ctx = {
      prepareRouteRateLimit: vi.fn(async () => {
        order.push('prepare')
        return { result: allowed, subject: 1 }
      }),
      settleRouteRateLimit: vi.fn(async () => {
        order.push('settle')
      }),
    }
    const out = await withOverlappedRateLimit(ctx, 'r', async () => {
      order.push('load')
      return 'user'
    })
    expect(out.value).toBe('user')
    expect(ctx.settleRouteRateLimit).not.toHaveBeenCalled()
    await out.settleRateLimit()
    expect(order).toEqual(['prepare', 'load', 'settle'])
    expect(ctx.settleRouteRateLimit).toHaveBeenCalledWith('r', { result: allowed, subject: 1 })
  })

  it('holds a limiter failure until settle, even when load fails first', async () => {
    const failure = new Error('limiter')
    const ctx = {
      prepareRouteRateLimit: vi.fn(async () => {
        throw failure
      }),
      settleRouteRateLimit: vi.fn(),
    }
    const out = await withOverlappedRateLimit(ctx, 'r', async () => 'v')
    await expect(out.settleRateLimit()).rejects.toBe(failure)
    expect(ctx.settleRouteRateLimit).not.toHaveBeenCalled()
    await expect(
      withOverlappedRateLimit(ctx, 'r', async () => {
        throw new Error('load')
      }),
    ).rejects.toThrow('load')
  })
})
