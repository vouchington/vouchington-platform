import { buildRateLimitKeys } from './keys.mts'
import type { BuildRateLimitKeysOptions } from './keys.mts'
import type {
  RateLimitBackend,
  RateLimitIdentities,
  RouteRateLimitPolicy,
  RouteRateLimitResult,
} from './types.mts'

export interface RouteRateLimiterOptions<TContext> extends BuildRateLimitKeysOptions {
  /** Chooses the backend for a route, so categories can use separate prefixes or windows. */
  getBackend(routeKey: string, context: TContext): RateLimitBackend
  /** Maps a route and its identities to the threshold and window. Product limits live here. */
  resolvePolicy(
    routeKey: string,
    identities: RateLimitIdentities,
    context: TContext,
  ): RouteRateLimitPolicy | Promise<RouteRateLimitPolicy>
  /** Receives backend failures. The request is allowed unless the policy sets `failClosed`. */
  onError?(error: Error): void
}

export interface RouteRateLimitCheckOptions {
  /**
   * Units to charge, all or nothing: either every identity is charged `cost` or none is. Omit it
   * to charge one unit with `addAndCheck`, which counts refused requests too.
   */
  cost?: number | undefined
}

export type CheckRouteRateLimit<TContext> = (
  routeKey: string,
  identities: RateLimitIdentities,
  context: TContext,
  options?: RouteRateLimitCheckOptions,
) => Promise<RouteRateLimitResult>

/** Creates a per-route check that charges every identity dimension in one atomic backend call. */
export function createRouteRateLimiter<TContext = undefined>(
  options: RouteRateLimiterOptions<TContext>,
): CheckRouteRateLimit<TContext> {
  return async (routeKey, identities, context, checkOptions = {}) => {
    const { cost } = checkOptions
    if (cost !== undefined && (!Number.isSafeInteger(cost) || cost < 1)) {
      throw new RangeError(`Rate-limit cost must be a positive integer, got ${cost}`)
    }
    const policy = await options.resolvePolicy(routeKey, identities, context)
    const { threshold, ttlSeconds } = policy
    const ids = buildRateLimitKeys(routeKey, identities, options)
    if (ids.length === 0) {
      return { limited: false, retryAfterSeconds: 0, limit: threshold, remaining: threshold }
    }
    try {
      const backend = options.getBackend(routeKey, context)
      const { counts, limited, retryAfterSeconds } =
        cost === undefined
          ? { ...(await backend.addAndCheck(ids, threshold, ttlSeconds)), retryAfterSeconds: 0 }
          : await consume(backend, ids, { threshold, ttlSeconds, cost })
      const maxCount = counts.length > 0 ? Math.max(...counts) : 0
      return {
        limited,
        retryAfterSeconds: limited && retryAfterSeconds > 0 ? retryAfterSeconds : ttlSeconds,
        limit: threshold,
        remaining: Math.max(0, threshold - maxCount),
      }
    } catch (err) {
      options.onError?.(err instanceof Error ? err : new Error(String(err)))
      if (policy.failClosed) {
        return { limited: true, retryAfterSeconds: ttlSeconds, limit: threshold, remaining: 0 }
      }
      return { limited: false, retryAfterSeconds: 0, limit: threshold, remaining: threshold }
    }
  }
}

async function consume(
  backend: RateLimitBackend,
  ids: string[],
  options: { threshold: number; ttlSeconds: number; cost: number },
) {
  const { counts, limited, retryAfterMs } = await backend.consume(ids, options)
  return { counts, limited, retryAfterSeconds: Math.ceil(retryAfterMs / 1000) }
}
