import type { RouteRateLimitResult } from './types.mts'

export interface RouteCharge {
  /** Caller's index for the unit being charged (e.g. a batch item). */
  index: number
  /** Routes the unit exercises, in precedence order. */
  routeKeys: readonly string[]
}

/**
 * Charges each unit against every route it exercises, one after another so a batch spends its
 * budget in order. A unit stops at the first route whose budget is spent. Returns the retry delay
 * in seconds for each refused unit, by index.
 */
export async function chargeRoutes(
  charges: readonly RouteCharge[],
  check: (routeKey: string) => Promise<RouteRateLimitResult>,
): Promise<ReadonlyMap<number, number>> {
  const refused = new Map<number, number>()
  for (const { index, routeKeys } of charges) {
    for (const routeKey of routeKeys) {
      // oxlint-disable-next-line no-await-in-loop -- a batch spends its budget in order, and a unit stops at its first spent route
      const result = await check(routeKey)
      if (!result.limited) continue
      refused.set(index, result.retryAfterSeconds)
      break
    }
  }
  return refused
}
