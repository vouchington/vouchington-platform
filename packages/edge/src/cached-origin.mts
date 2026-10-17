import type { CacheContext } from '@cloudflare/workers-types'
import {
  buildCacheControlHeader,
  isCacheableResponse,
  type CacheControlOptions,
} from './cache-policy.mts'
import { DEFAULT_SAFE_CACHE_VARY_TOKENS, parseSafeCacheVary } from './cache-vary.mts'
import { copyHeaders, withHeaders } from './headers.mts'

const PRIVATE_NO_STORE = { 'cache-control': 'private, no-store' } as const

/** Per-request headers that must not be frozen into bytes replayed to other clients. */
export const SHARED_CACHE_VOLATILE_HEADERS: readonly string[] = [
  'content-security-policy',
  'content-security-policy-report-only',
]

/** Copies headers for a shared cache entry, removing request-specific ones. */
export function stripCacheHeaders(
  headers: Headers,
  volatile: readonly string[] = SHARED_CACHE_VOLATILE_HEADERS,
): Headers {
  const copied = copyHeaders(headers)
  for (const name of volatile) copied.delete(name)
  return copied
}

export type FinalizeCachedOriginOptions = {
  ttlSeconds: number
  /** Cache tags for the entry; used for purging. */
  tags: readonly string[]
  /**
   * Header that carries the origin's `Vary` tokens inside the cache. The platform cache ignores
   * `vary`, so the application re-reads this header on HIT to apply client-facing `Vary`.
   */
  internalVaryHeader: string
  /** `Vary` tokens that are safe to cache. Any other token makes the response uncacheable. */
  safeVaryTokens?: readonly string[]
  cacheControl?: CacheControlOptions
  /** Appended to `tags` when it returns true for the origin's own `Cache-Tag` value. */
  isValidOriginTag?: (tag: string) => boolean
}

/**
 * Prepares an origin response for the shared cache: uncacheable responses get `private, no-store`;
 * cacheable ones lose `set-cookie` and volatile headers and gain `cache-control`, the internal
 * vary header, and `Cache-Tag`.
 */
export function finalizeCachedOriginResponse(
  originResponse: Response,
  options: FinalizeCachedOriginOptions,
): Response {
  if (!isCacheableResponse(originResponse)) return withHeaders(originResponse, PRIVATE_NO_STORE)

  const varyTokens = parseSafeCacheVary(
    originResponse.headers.get('vary'),
    options.safeVaryTokens ?? DEFAULT_SAFE_CACHE_VARY_TOKENS,
  )
  const headers = stripCacheHeaders(originResponse.headers)
  headers.delete(options.internalVaryHeader)
  headers.delete('set-cookie')
  const rebuild = () =>
    new Response(originResponse.body, {
      status: originResponse.status,
      statusText: originResponse.statusText,
      headers,
    })
  if (varyTokens === null) {
    headers.set('cache-control', PRIVATE_NO_STORE['cache-control'])
    return rebuild()
  }
  headers.delete('vary')
  if (varyTokens.length > 0) headers.set(options.internalVaryHeader, varyTokens.join(', '))
  headers.set('cache-control', buildCacheControlHeader(options.ttlSeconds, options.cacheControl))
  const tags = [...options.tags]
  const originTag = originResponse.headers.get('Cache-Tag')
  if (originTag && options.isValidOriginTag?.(originTag) && !tags.includes(originTag)) {
    tags.push(originTag)
  }
  headers.set('Cache-Tag', tags.join(','))
  return rebuild()
}

/**
 * Removes dispatch-only signals before building an origin request. A dispatch IP header is
 * restored as `cf-connecting-ip` so downstream forwarding keeps the client address.
 */
export function stripDispatchOnlyHeaders(
  request: Request,
  options: { dropHeaders: readonly string[]; ipHeader?: string },
): Request {
  const headers = new Headers(request.headers)
  const ip = options.ipHeader ? headers.get(options.ipHeader) : null
  for (const name of options.dropHeaders) headers.delete(name)
  if (options.ipHeader) headers.delete(options.ipHeader)
  if (ip) headers.set('cf-connecting-ip', ip)
  return new Request(request, { headers })
}

/**
 * Purges tags from the cache namespace of the current entrypoint. Throws when the execution
 * context has no cache API, because a silent no-op would leave stale content serving.
 */
export async function purgeCacheTags(context: { cache?: CacheContext }, tags: string[]) {
  if (!context.cache) {
    throw new Error('Workers Cache purge API unavailable on this execution context')
  }
  return context.cache.purge({ tags })
}
