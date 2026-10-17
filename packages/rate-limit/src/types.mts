import type { RateLimiter } from 'valkyries/rate-limiter'

/** The slice of a valkyries `RateLimiter` this package drives. Any structural fake satisfies it. */
export type RateLimitBackend = Pick<RateLimiter, 'addAndCheck'>

/** Identity dimension name to value, e.g. `{ ip, did, uid }`. Falsy values are skipped. */
export type RateLimitIdentities = Readonly<Record<string, string | undefined>>

export interface RouteRateLimitPolicy {
  /** Requests allowed per window; the Nth request in a window is the first one refused. */
  threshold: number
  ttlSeconds: number
  /** Refuse requests when the backend is unreachable instead of failing open. */
  failClosed?: boolean | undefined
}

export interface RouteRateLimitResult {
  limited: boolean
  retryAfterSeconds: number
  limit: number
  remaining: number
}
