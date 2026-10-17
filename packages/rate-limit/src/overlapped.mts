import type { Context } from '@jongleberry/api-server'

export interface WithRateLimit<TValue> {
  value: TValue
  /**
   * Applies the already-charged limiter result (429 and headers), then runs the settle hook. Call
   * it exactly once, at the point the route's precedence needs the limiter outcome.
   */
  settleRateLimit(): Promise<void>
}

/**
 * Charges the route limiter while `load` runs, so the two overlap and the request saves one serial
 * round trip. Headers and 429s are deferred to `settleRateLimit`, leaving status precedence to the
 * caller. A limiter failure is held until settle, so a `load` failure cannot leave an unhandled
 * rejection.
 */
export async function withOverlappedRateLimit<TValue>(
  ctx: Pick<Context, 'prepareRouteRateLimit' | 'settleRouteRateLimit'>,
  routeKey: string,
  load: () => Promise<TValue>,
): Promise<WithRateLimit<TValue>> {
  const prepared = ctx.prepareRouteRateLimit(routeKey).then(
    (check) => ({ check }) as const,
    (err: unknown) => ({ err }) as const,
  )
  const value = await load()
  return {
    value,
    settleRateLimit: async () => {
      const outcome = await prepared
      if ('err' in outcome) throw outcome.err
      await ctx.settleRouteRateLimit(routeKey, outcome.check)
    },
  }
}
