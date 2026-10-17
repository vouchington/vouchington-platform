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

export type CheckRouteRateLimit<TContext> = (
  routeKey: string,
  identities: RateLimitIdentities,
  context: TContext,
) => Promise<RouteRateLimitResult>

/** Creates a per-route check that charges every identity dimension in one atomic backend call. */
export function createRouteRateLimiter<TContext = undefined>(
  options: RouteRateLimiterOptions<TContext>,
): CheckRouteRateLimit<TContext> {
  return async (routeKey, identities, context) => {
    const policy = await options.resolvePolicy(routeKey, identities, context)
    const { threshold, ttlSeconds } = policy
    const ids = buildRateLimitKeys(routeKey, identities, options)
    if (ids.length === 0) {
      return { limited: false, retryAfterSeconds: 0, limit: threshold, remaining: threshold }
    }
    try {
      const { counts, limited } = await options
        .getBackend(routeKey, context)
        .addAndCheck(ids, threshold, ttlSeconds)
      const maxCount = counts.length > 0 ? Math.max(...counts) : 0
      return {
        limited,
        retryAfterSeconds: ttlSeconds,
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
