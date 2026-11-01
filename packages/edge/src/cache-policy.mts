export type CacheMode = 'cache' | 'bypass'

export type CachePolicy<Audience extends string = string> = {
  mode: CacheMode
  /** Which audience a cached response targets; null on bypass. Partition cache keys by it. */
  audience: Audience | null
  /** True when a bypassed response must not stay browser or intermediary cacheable. */
  forceNoStore: boolean
  ttlSeconds: number
  staleWhileRevalidateSeconds: number
  stripCookieNames: ReadonlySet<string>
  stripAllCookies: boolean
}

const EMPTY_SET: ReadonlySet<string> = new Set()

/** Pass the request to the origin untouched by any cache. */
export function bypassPolicy<Audience extends string = string>(
  options: { forceNoStore?: boolean; stripCookieNames?: ReadonlySet<string> } = {},
): CachePolicy<Audience> {
  return {
    mode: 'bypass',
    audience: null,
    forceNoStore: options.forceNoStore ?? false,
    ttlSeconds: 0,
    staleWhileRevalidateSeconds: 0,
    stripCookieNames: options.stripCookieNames ?? EMPTY_SET,
    stripAllCookies: false,
  }
}

/** Serve an audience's response from the shared cache; cookies are stripped by default. */
export function cachedPolicy<Audience extends string>(
  audience: Audience,
  ttlSeconds: number,
  options: { stripCookieNames?: ReadonlySet<string>; stripAllCookies?: boolean } = {},
): CachePolicy<Audience> {
  return {
    mode: 'cache',
    audience,
    forceNoStore: false,
    ttlSeconds,
    staleWhileRevalidateSeconds: ttlSeconds * 2,
    stripCookieNames: options.stripCookieNames ?? EMPTY_SET,
    stripAllCookies: options.stripAllCookies ?? true,
  }
}

/** Parses a positive TTL from configuration, flooring it; anything else yields `fallback`. */
export function toPositiveNumber(raw: string | undefined, fallback: number): number {
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return fallback
  return Math.floor(value)
}

/** Parses a comma-separated path list and merges it into `defaults` (never replaces them). */
export function parsePathSet(
  raw: string | undefined,
  defaults: Iterable<string> = [],
): Set<string> {
  const extra = (raw ?? '')
    .split(',')
    .map((path) => path.trim())
    .filter(Boolean)
  return new Set([...defaults, ...extra])
}

/** Case-insensitive match of an exact path or any path below a prefix. */
export function matchesPathPrefix(pathname: string, prefixes: readonly string[]): boolean {
  const normalized = pathname.toLowerCase()
  return prefixes.some((raw) => {
    const prefix = raw.toLowerCase()
    return normalized === prefix || normalized.startsWith(`${prefix}/`)
  })
}

export function canUseCache(request: Request, mode: CacheMode): boolean {
  return mode === 'cache' && request.method === 'GET'
}

/** React Server Component fetch signal: `_rsc` param, `text/x-component` accept, or `rsc: 1`. */
export function isRscRequest(request: Request, url: URL): boolean {
  return (
    url.searchParams.has('_rsc') ||
    (request.headers.get('accept') ?? '').toLowerCase().includes('text/x-component') ||
    request.headers.get('rsc') === '1'
  )
}

export type CacheControlOptions = {
  /** Multiplier applied to the TTL for `stale-while-revalidate`. Defaults to 2. */
  staleWhileRevalidateFactor?: number
  /** Bound on serving stale content during origin errors. Defaults to one day. */
  staleIfErrorSeconds?: number
}

/** `cache-control` for a response whose only cache layer is the platform cache. */
export function buildCacheControlHeader(
  ttlSeconds: number,
  options: CacheControlOptions = {},
): string {
  const factor = options.staleWhileRevalidateFactor ?? 2
  const staleIfError = options.staleIfErrorSeconds ?? 86_400
  return `public, max-age=${ttlSeconds}, stale-while-revalidate=${ttlSeconds * factor}, stale-if-error=${staleIfError}`
}

function hasDisqualifyingCacheControl(headers: Headers): boolean {
  return (headers.get('cache-control') ?? '')
    .split(',')
    .map((part) => part.split('=')[0]!.trim().toLowerCase())
    .some((name) => name === 'private' || name === 'no-store' || name === 'no-cache')
}

/**
 * A 2xx response without `set-cookie` or a private/no-store/no-cache directive. Qualified forms
 * such as `private="x-user"` also disqualify.
 */
export function isCacheableResponse(response: Response): boolean {
  if (response.status < 200 || response.status >= 300) return false
  if (hasDisqualifyingCacheControl(response.headers)) return false
  return !response.headers.has('set-cookie')
}
