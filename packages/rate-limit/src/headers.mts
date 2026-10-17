import type { Context } from '@jongleberry/api-server'

import type { RouteRateLimitResult } from './types.mts'

export interface ApplyRateLimitResultOptions {
  message?: string
}

/**
 * Sets `X-RateLimit-*` headers (when the route has a limit) and throws 429 with `Retry-After`
 * when the result is limited.
 */
export function applyRateLimitResult(
  ctx: Pick<Context, 'set' | 'throw'>,
  result: RouteRateLimitResult,
  options: ApplyRateLimitResultOptions = {},
): void {
  if (result.limit > 0) {
    ctx.set('X-RateLimit-Limit', String(result.limit))
    ctx.set('X-RateLimit-Remaining', String(result.remaining))
  }
  if (result.limited) {
    ctx.set('Retry-After', String(result.retryAfterSeconds))
    ctx.throw(429, options.message ?? 'Rate limit exceeded. Please try again later.')
  }
}
