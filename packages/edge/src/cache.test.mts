import { describe, expect, it } from 'vitest'
import {
  bypassPolicy,
  buildCacheControlHeader,
  cachedPolicy,
  canUseCache,
  isCacheableResponse,
  isRscRequest,
  matchesPathPrefix,
  parsePathSet,
  toPositiveNumber,
} from './cache-policy.mts'
import { DEFAULT_NO_VARY_SEARCH_PARAM_NAMES, normalizeCacheUrl } from './cache-url.mts'
import { mergeClientVary, parseSafeCacheVary } from './cache-vary.mts'
import {
  finalizeCachedOriginResponse,
  purgeCacheTags,
  stripCacheHeaders,
  stripDispatchOnlyHeaders,
} from './cached-origin.mts'

describe('cache policy', () => {
  it('builds bypass policies', () => {
    expect(bypassPolicy()).toMatchObject({
      mode: 'bypass',
      audience: null,
      forceNoStore: false,
      ttlSeconds: 0,
      stripAllCookies: false,
    })
    const names = new Set(['st'])
    const noStore = bypassPolicy({ forceNoStore: true, stripCookieNames: names })
    expect(noStore.forceNoStore).toBe(true)
    expect(noStore.stripCookieNames).toBe(names)
  })

  it('builds cached policies', () => {
    expect(cachedPolicy('anon', 60)).toMatchObject({
      mode: 'cache',
      audience: 'anon',
      ttlSeconds: 60,
      staleWhileRevalidateSeconds: 120,
      stripAllCookies: true,
      forceNoStore: false,
    })
    const names = new Set(['st'])
    const custom = cachedPolicy('bot', 5, { stripCookieNames: names, stripAllCookies: false })
    expect(custom.stripCookieNames).toBe(names)
    expect(custom.stripAllCookies).toBe(false)
  })

  it.each([
    [undefined, 7, 7],
    ['abc', 7, 7],
    ['0', 7, 7],
    ['-3', 7, 7],
    ['Infinity', 7, 7],
    ['12.9', 7, 12],
  ])('parses TTL %s', (raw, fallback, expected) => {
    expect(toPositiveNumber(raw, fallback)).toBe(expected)
  })

  it('merges configured paths into defaults', () => {
    expect([...parsePathSet(' /a, ,/b ,', ['/robots.txt'])]).toEqual(['/robots.txt', '/a', '/b'])
    expect([...parsePathSet(undefined)]).toEqual([])
  })

  it('matches exact paths and sub-paths, case-insensitively', () => {
    const prefixes = ['/api/private']
    expect(matchesPathPrefix('/API/Private', prefixes)).toBe(true)
    expect(matchesPathPrefix('/api/private/x', prefixes)).toBe(true)
    expect(matchesPathPrefix('/api/privately', prefixes)).toBe(false)
    expect(matchesPathPrefix('/api/private/x', ['/API/Private'])).toBe(true)
  })

  it('caches only GET requests in cache mode', () => {
    const get = new Request('https://example.com/')
    const post = new Request('https://example.com/', { method: 'POST' })
    expect(canUseCache(get, 'cache')).toBe(true)
    expect(canUseCache(get, 'bypass')).toBe(false)
    expect(canUseCache(post, 'cache')).toBe(false)
  })

  it('detects RSC requests by param, accept, or header', () => {
    const detect = (url: string, headers: Record<string, string> = {}) =>
      isRscRequest(new Request(url, { headers }), new URL(url))
    expect(detect('https://example.com/?_rsc=1')).toBe(true)
    expect(detect('https://example.com/', { accept: 'Text/X-Component' })).toBe(true)
    expect(detect('https://example.com/', { rsc: '1' })).toBe(true)
    expect(detect('https://example.com/', { rsc: '0', accept: 'text/html' })).toBe(false)
    expect(detect('https://example.com/')).toBe(false)
  })

  it('builds cache-control with defaults and overrides', () => {
    expect(buildCacheControlHeader(60)).toBe(
      'public, max-age=60, stale-while-revalidate=120, stale-if-error=86400',
    )
    expect(
      buildCacheControlHeader(60, { staleWhileRevalidateFactor: 3, staleIfErrorSeconds: 5 }),
    ).toBe('public, max-age=60, stale-while-revalidate=180, stale-if-error=5')
  })

  it('judges response cacheability', () => {
    expect(isCacheableResponse(new Response('ok'))).toBe(true)
    expect(isCacheableResponse(new Response('x', { status: 404 }))).toBe(false)
    expect(isCacheableResponse(new Response(null, { status: 301 }))).toBe(false)
    for (const value of [
      'private',
      'no-store',
      'No-Cache, max-age=0',
      'private="X-User"',
      'no-cache="X-Token", max-age=60',
    ]) {
      expect(isCacheableResponse(new Response('x', { headers: { 'cache-control': value } }))).toBe(
        false,
      )
    }
    expect(isCacheableResponse(new Response('x', { headers: { 'cache-control': 'public' } }))).toBe(
      true,
    )
    expect(isCacheableResponse(new Response('x', { headers: { 'set-cookie': 'a=1' } }))).toBe(false)
  })
})

describe('cache vary', () => {
  it('canonicalizes safe tokens and dedupes', () => {
    expect(parseSafeCacheVary(null)).toEqual([])
    expect(parseSafeCacheVary('cookie, ACCEPT-ENCODING,, cookie')).toEqual([
      'Cookie',
      'Accept-Encoding',
    ])
    expect(parseSafeCacheVary('')).toEqual([])
    expect(parseSafeCacheVary('Accept-Language')).toBeNull()
    expect(parseSafeCacheVary('accept-language', ['Accept-Language'])).toEqual(['Accept-Language'])
  })

  it('rejects unsafe tokens and honors an injected allow list', () => {
    expect(parseSafeCacheVary('Cookie, User-Agent')).toBeNull()
    expect(parseSafeCacheVary('*')).toBeNull()
    expect(parseSafeCacheVary('RSC', ['RSC'])).toEqual(['RSC'])
    expect(parseSafeCacheVary('Cookie', ['RSC'])).toBeNull()
  })

  it('merges client vary values', () => {
    expect(mergeClientVary(null, [])).toBeNull()
    expect(mergeClientVary(null, ['RSC'])).toBe('RSC')
    expect(mergeClientVary('Accept, rsc', ['RSC', 'Cookie'])).toBe('Accept, rsc, Cookie')
    expect(mergeClientVary('Accept, *', ['RSC'])).toBe('*')
    expect(mergeClientVary(' , ', [])).toBeNull()
  })
})

describe('normalizeCacheUrl', () => {
  it('drops tracking params and sorts the rest', () => {
    expect(normalizeCacheUrl('https://example.com/p?b=2&utm_source=x&a=1&gclid=z')).toBe(
      'https://example.com/p?a=1&b=2',
    )
    expect(DEFAULT_NO_VARY_SEARCH_PARAM_NAMES).toContain('fbclid')
  })

  it('accepts a custom strip list', () => {
    const url = 'https://example.com/?_rsc=1&utm_source=x'
    expect(normalizeCacheUrl(url, { stripParams: ['_rsc'] })).toBe(
      'https://example.com/?utm_source=x',
    )
    expect(
      normalizeCacheUrl(url, { stripParams: [...DEFAULT_NO_VARY_SEARCH_PARAM_NAMES, '_rsc'] }),
    ).toBe('https://example.com/')
  })
})

describe('cached origin responses', () => {
  const base = { ttlSeconds: 60, tags: ['route:a'], internalVaryHeader: 'x-int-vary' }

  it('strips volatile headers from copies', () => {
    const headers = new Headers({ 'content-security-policy': 'x', 'x-keep': '1' })
    expect([...stripCacheHeaders(headers).keys()]).toEqual(['x-keep'])
    expect([...stripCacheHeaders(headers, ['x-keep']).keys()]).toEqual(['content-security-policy'])
  })

  it('marks uncacheable responses private', () => {
    const response = finalizeCachedOriginResponse(
      new Response('x', { status: 404, headers: { 'set-cookie': 'a=1' } }),
      base,
    )
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.getSetCookie()).toEqual(['a=1'])
  })

  it('refuses to cache responses with unsafe vary', async () => {
    const response = finalizeCachedOriginResponse(
      new Response('body', {
        status: 200,
        statusText: 'OK',
        headers: {
          vary: 'User-Agent',
          'content-security-policy': 'x',
          [base.internalVaryHeader]: 'forged',
        },
      }),
      base,
    )
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.has('content-security-policy')).toBe(false)
    expect(response.headers.has(base.internalVaryHeader)).toBe(false)
    expect(response.headers.has('Cache-Tag')).toBe(false)
    expect(await response.text()).toBe('body')
  })

  it('finalizes cacheable responses with internal vary, tags, and cache-control', () => {
    const response = finalizeCachedOriginResponse(
      new Response('x', {
        headers: { vary: 'cookie', 'content-security-policy': 'x', 'cache-tag': 'origin-tag' },
      }),
      { ...base, isValidOriginTag: () => true },
    )
    expect(response.headers.has('vary')).toBe(false)
    expect(response.headers.get('x-int-vary')).toBe('Cookie')
    expect(response.headers.get('cache-control')).toContain('max-age=60')
    expect(response.headers.get('Cache-Tag')).toBe('route:a,origin-tag')
    expect(response.headers.has('content-security-policy')).toBe(false)
  })

  it('skips the internal vary header without vary tokens', () => {
    const response = finalizeCachedOriginResponse(new Response('x'), base)
    expect(response.headers.has('x-int-vary')).toBe(false)
    expect(response.headers.get('Cache-Tag')).toBe('route:a')
  })

  it('applies custom vary tokens and cache-control options', () => {
    const response = finalizeCachedOriginResponse(new Response('x', { headers: { vary: 'rsc' } }), {
      ...base,
      safeVaryTokens: ['RSC'],
      cacheControl: { staleIfErrorSeconds: 1 },
    })
    expect(response.headers.get('x-int-vary')).toBe('RSC')
    expect(response.headers.get('cache-control')).toContain('stale-if-error=1')
  })

  it('only trusts origin tags that validate and are new', () => {
    const origin = (tag: string) => new Response('x', { headers: { 'Cache-Tag': tag } })
    const tagOf = (response: Response) => response.headers.get('Cache-Tag')
    expect(tagOf(finalizeCachedOriginResponse(origin('t'), base))).toBe('route:a')
    expect(
      tagOf(finalizeCachedOriginResponse(origin('t'), { ...base, isValidOriginTag: () => false })),
    ).toBe('route:a')
    expect(
      tagOf(
        finalizeCachedOriginResponse(origin('route:a'), { ...base, isValidOriginTag: () => true }),
      ),
    ).toBe('route:a')
  })
})

describe('stripDispatchOnlyHeaders', () => {
  const dispatch = () =>
    new Request('https://example.com/', {
      headers: { 'x-d-tier': 'bot', 'x-d-ip': '203.0.113.9', 'x-keep': '1' },
    })

  it('removes dispatch signals and restores the client address', () => {
    const result = stripDispatchOnlyHeaders(dispatch(), {
      dropHeaders: ['x-d-tier'],
      ipHeader: 'x-d-ip',
    })
    expect([...result.headers.keys()].sort()).toEqual(['cf-connecting-ip', 'x-keep'])
    expect(result.headers.get('cf-connecting-ip')).toBe('203.0.113.9')
  })

  it('handles a missing address and an unconfigured ip header', () => {
    const noIp = new Request('https://example.com/', { headers: { 'x-d-ip': '' } })
    const withoutAddress = stripDispatchOnlyHeaders(noIp, { dropHeaders: [], ipHeader: 'x-d-ip' })
    expect(withoutAddress.headers.has('cf-connecting-ip')).toBe(false)
    const plain = stripDispatchOnlyHeaders(dispatch(), { dropHeaders: ['x-d-tier'] })
    expect(plain.headers.has('x-d-ip')).toBe(true)
    expect(plain.headers.has('x-d-tier')).toBe(false)
  })
})

describe('purgeCacheTags', () => {
  it('purges through the execution context cache', async () => {
    const purge = async (options: { tags: string[] }) => ({
      success: true,
      errors: [],
      tags: options.tags,
    })
    const result = await purgeCacheTags({ cache: { purge } }, ['a'])
    expect(result).toMatchObject({ success: true, tags: ['a'] })
  })

  it('throws instead of silently skipping the purge', async () => {
    await expect(purgeCacheTags({}, ['a'])).rejects.toThrow('purge API unavailable')
  })
})
