/**
 * Parses a `Retry-After` header (delay seconds or an HTTP date) into milliseconds, or null when it
 * is absent or unusable.
 */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | null {
  const text = value?.trim()
  if (!text) return null
  if (/^\d+$/.test(text)) return Number(text) * 1000
  const at = Date.parse(text)
  return Number.isNaN(at) ? null : Math.max(0, at - now)
}

/**
 * True for statuses where the provider may have billed the request despite the failure: 408, 409,
 * 429 and every 5xx.
 */
export function isAmbiguousBilledHttpStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500
}

/** Reads a header from a `Headers`-like or plain-object bag, case-insensitively. */
export function readHeader(headers: unknown, name: string): string | undefined {
  if (typeof headers !== 'object' || headers === null) return undefined
  if ('get' in headers && typeof headers.get === 'function') {
    return (headers.get(name) as string | null) ?? undefined
  }
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name)
  const value: unknown = entry?.[1]
  return typeof value === 'string' ? value : undefined
}
