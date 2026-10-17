import { checkEdgeBuckets } from './bindings.mts'
import type { EdgeBucket } from './bindings.mts'

export interface EdgeRateLimitRejectionOptions<TResponse> {
  buckets: readonly EdgeBucket[]
  ip: string | null | undefined
  /** True when any rate-limit binding is configured at all, even one skipped for this request. */
  hasAnyBinding: boolean
  /** Exempt requests skip both the missing-IP rejection and the buckets. */
  bypass: boolean
  /** Response for a request with no client IP while limiting is configured. */
  missingIp(): TResponse
  /** Response for a refused request. */
  limited(): TResponse
}

/** Returns the rejection response, or `null` when the request may proceed. */
export async function getEdgeRateLimitRejection<TResponse>(
  options: EdgeRateLimitRejectionOptions<TResponse>,
): Promise<TResponse | null> {
  if (options.bypass) return null
  if (!options.ip && options.hasAnyBinding) return options.missingIp()
  const allowed = await checkEdgeBuckets(options.buckets, options.ip)
  return allowed ? null : options.limited()
}
