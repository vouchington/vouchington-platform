import type { RouteRateLimitResult } from './types.mts'

export interface RouteCharge {
  /** Caller's index for the unit being charged (e.g. a batch item). */
  index: number
  /** Routes the unit exercises, in precedence order. */
  routeKeys: readonly string[]
  /**
   * Units this charge spends on each route, passed to `check` as its cost. Omit it for one unit
   * charged the default way. Each route is all or nothing, but routes are not atomic together:
   * units already spent on earlier routes stay spent when a later route refuses.
   */
  weight?: number | undefined
}

/**
 * Charges each unit against every route it exercises, one after another so a batch spends its
 * budget in order. A unit stops at the first route whose budget is spent. Returns the retry delay
 * in seconds for each refused unit, by index.
 */
export async function chargeRoutes(
  charges: readonly RouteCharge[],
  check: (routeKey: string, cost: number | undefined) => Promise<RouteRateLimitResult>,
): Promise<ReadonlyMap<number, number>> {
  const refused = new Map<number, number>()
  for (const { index, routeKeys, weight } of charges) {
    for (const routeKey of routeKeys) {
      // oxlint-disable-next-line no-await-in-loop -- a batch spends its budget in order, and a unit stops at its first spent route
      const result = await check(routeKey, weight)
      if (!result.limited) continue
      refused.set(index, result.retryAfterSeconds)
      break
    }
  }
  return refused
}
