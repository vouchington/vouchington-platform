/** The Cloudflare Workers rate-limit binding surface this package uses. */
export interface RateLimitBinding {
  limit(input: { key: string }): Promise<{ success: boolean }>
}

export interface EdgeBucket {
  /** A missing binding means the bucket is not configured and is skipped. */
  binding: RateLimitBinding | null | undefined
  /** Builds the binding key for the caller's client IP. */
  key(ip: string): string
}

/** Joins key parts with `:`, e.g. `('anon', 'api', 'GET', ip)` becomes `anon:api:GET:1.2.3.4`. */
export function buildEdgeRateLimitKey(...parts: readonly string[]): string {
  return parts.join(':')
}

/** True when any named binding exists on the Worker env. */
export function hasAnyRateLimitBinding(
  env: Readonly<Record<string, unknown>>,
  names: readonly string[],
): boolean {
  return names.some((name) => Boolean(env[name]))
}

/**
 * Charges the configured buckets in order and stops at the first refusal. With no configured
 * bucket the request is allowed; with one and no client IP it is refused (defence in depth behind
 * the caller's own missing-IP rejection).
 */
export async function checkEdgeBuckets(
  buckets: readonly EdgeBucket[],
  ip: string | null | undefined,
): Promise<boolean> {
  if (!buckets.some((bucket) => bucket.binding)) return true
  if (!ip) return false
  for (const bucket of buckets) {
    if (!bucket.binding) continue
    // oxlint-disable-next-line no-await-in-loop -- buckets are charged in order and stop at the first refusal
    const { success } = await bucket.binding.limit({ key: bucket.key(ip) })
    if (!success) return false
  }
  return true
}
