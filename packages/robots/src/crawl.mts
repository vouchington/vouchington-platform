/**
 * Extracts the RFC 9309 product token from a User-Agent string: the first token, without a
 * `/version` suffix. Returns `*` when no token remains.
 */
export function robotsProductToken(userAgent: string): string {
  const trimmed = userAgent.trim()
  const end = trimmed.search(/[ \t/]/)
  const token = (end === -1 ? trimmed : trimmed.slice(0, end)).trim()
  return token || '*'
}

export interface CrawlIntervalOptions {
  /** Caller's own requests-per-second ceiling for the host; null, undefined, or <= 0 means none. */
  requestsPerSecond?: number | null
  /** The host's robots.txt Crawl-delay in milliseconds, or null when none applies. */
  crawlDelayMs?: number | null
  /** Interval used when `requestsPerSecond` states no limit. Defaults to 1000. */
  defaultIntervalMs?: number
  /** Ceiling for the result. Defaults to 60000. */
  maxIntervalMs?: number
}

/** Picks the larger of the caller's own interval and the host's Crawl-delay, capped at a maximum. */
export function computeCrawlIntervalMs(options: CrawlIntervalOptions = {}): number {
  const { requestsPerSecond, crawlDelayMs } = options
  const { defaultIntervalMs = 1_000, maxIntervalMs = 60_000 } = options
  const ownInterval =
    requestsPerSecond != null && requestsPerSecond > 0
      ? Math.ceil(1000 / requestsPerSecond)
      : defaultIntervalMs
  return Math.min(maxIntervalMs, Math.max(ownInterval, crawlDelayMs ?? 0))
}
