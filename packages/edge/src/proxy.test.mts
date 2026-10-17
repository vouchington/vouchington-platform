import { describe, expect, it, vi } from 'vitest'
import {
  applyClientInfoHeaders,
  hasBrowserFetchMetadata,
  isWebBrowserRequest,
} from './client-info.mts'
import { parseCookies, replaceCookies, stripCookies } from './cookies.mts'
import { fetchOriginResponse } from './origin-fetch.mts'
import {
  CLIENT_SUPPLIED_PROXY_HEADERS_TO_STRIP,
  NEXTJS_INTERNAL_HEADERS_TO_STRIP,
  buildOriginRequest,
} from './proxy.mts'

const ORIGIN = 'https://origin.internal:8443'

function incoming(
  path = '/page?a=1',
  headers: Record<string, string> = {},
  init: RequestInit = {},
): Request {
  return new Request(`https://example.com${path}`, { headers, ...init })
}

describe('cookies', () => {
  it('re-exports the shared parser', () => {
    expect(parseCookies('a=1; b=2').get('b')).toBe('2')
  })

  it('replaces cookies, skips undefined values, and validates', () => {
    expect(replaceCookies('a=1', { a: '2', b: '3', c: undefined })).toBe('a=2; b=3')
    expect(replaceCookies(null, {})).toBe('')
    const validate = vi.fn((name: string, value: string) => {
      if (value.includes(';')) throw new Error(`bad ${name}`)
    })
    expect(replaceCookies('', { a: '1' }, validate)).toBe('a=1')
    expect(() => replaceCookies('', { a: '1;' }, validate)).toThrow('bad a')
  })

  it('strips cookies and returns null when none remain', () => {
    expect(stripCookies('a=1; b=2', new Set(['a']))).toBe('b=2')
    expect(stripCookies('a=1', ['a'])).toBeNull()
    expect(stripCookies(undefined, [])).toBeNull()
  })
})

describe('buildOriginRequest', () => {
  it('retargets the origin and sets forwarding headers', () => {
    const request = buildOriginRequest(
      incoming('/page?a=1', { 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '1.1.1.1' }),
      { origin: ORIGIN },
    )
    expect(request.url).toBe(`${ORIGIN}/page?a=1`)
    expect(request.redirect).toBe('manual')
    expect(request.headers.get('x-forwarded-host')).toBe('example.com')
    expect(request.headers.get('x-forwarded-proto')).toBe('https')
    expect(request.headers.get('x-forwarded-for')).toBe('203.0.113.9')
    expect(request.headers.has('cf-connecting-ip')).toBe(false)
  })

  it('omits x-forwarded-for without a client address and strips spoofable headers', () => {
    const spoofed = Object.fromEntries(
      CLIENT_SUPPLIED_PROXY_HEADERS_TO_STRIP.filter((name) => name !== 'cf-connecting-ip').map(
        (name) => [name, 'x'],
      ),
    )
    const request = buildOriginRequest(incoming('/', spoofed), { origin: ORIGIN })
    for (const name of CLIENT_SUPPLIED_PROXY_HEADERS_TO_STRIP)
      expect(request.headers.has(name)).toBe(false)
  })

  it('merges path overrides over the query string', () => {
    const request = buildOriginRequest(incoming('/old?a=1&b=2'), {
      origin: ORIGIN,
      pathOverride: '/new?b=9&c=3',
    })
    expect(new URL(request.url).pathname).toBe('/new')
    expect(new URL(request.url).searchParams.toString()).toBe('a=1&b=9&c=3')
    const nullOverride = buildOriginRequest(incoming('/keep'), {
      origin: ORIGIN,
      pathOverride: null,
    })
    expect(new URL(nullOverride.url).pathname).toBe('/keep')
  })

  it('strips named cookies, all cookies, or nothing', () => {
    const headers = { cookie: 'a=1; b=2' }
    const some = buildOriginRequest(incoming('/', headers), {
      origin: ORIGIN,
      stripCookieNames: new Set(['a']),
    })
    expect(some.headers.get('cookie')).toBe('b=2')
    const all = buildOriginRequest(incoming('/', headers), {
      origin: ORIGIN,
      stripAllCookies: true,
    })
    expect(all.headers.has('cookie')).toBe(false)
    const emptied = buildOriginRequest(incoming('/', { cookie: 'a=1' }), {
      origin: ORIGIN,
      stripCookieNames: new Set(['a']),
    })
    expect(emptied.headers.has('cookie')).toBe(false)
    const untouched = buildOriginRequest(incoming('/', headers), { origin: ORIGIN })
    expect(untouched.headers.get('cookie')).toBe('a=1; b=2')
  })

  it('drops authorization unless the matching scheme is preserved', () => {
    const bearer = { authorization: 'Bearer t' }
    const basic = { authorization: 'Basic dTpw' }
    const has = (headers: Record<string, string>, extra = {}) =>
      buildOriginRequest(incoming('/', headers), { origin: ORIGIN, ...extra }).headers.has(
        'authorization',
      )
    expect(has(bearer)).toBe(false)
    expect(has(basic)).toBe(false)
    expect(has(bearer, { preserveNonBasicAuthorization: true })).toBe(true)
    expect(has(basic, { preserveNonBasicAuthorization: true })).toBe(false)
    expect(has(basic, { preserveBasicAuthorization: true })).toBe(true)
    expect(has(bearer, { preserveBasicAuthorization: true })).toBe(false)
    expect(has({}, { preserveNonBasicAuthorization: true })).toBe(false)
  })

  it('owns the shared secret and request id headers', () => {
    const headers = { 'x-secret': 'client', 'x-request-id': 'client' }
    const request = buildOriginRequest(incoming('/', headers), {
      origin: ORIGIN,
      sharedSecret: { header: 'x-secret', value: 'server' },
      requestId: 'req-1',
    })
    expect(request.headers.get('x-secret')).toBe('server')
    expect(request.headers.get('x-request-id')).toBe('req-1')
    const bare = buildOriginRequest(incoming('/', headers), {
      origin: ORIGIN,
      sharedSecret: { header: 'x-secret', value: undefined },
      requestIdHeader: 'x-trace',
    })
    expect(bare.headers.has('x-secret')).toBe(false)
    expect(bare.headers.get('x-request-id')).toBe('client')
    const custom = buildOriginRequest(incoming('/', { 'x-trace': 'client' }), {
      origin: ORIGIN,
      requestIdHeader: 'x-trace',
      requestId: 'req-2',
    })
    expect(custom.headers.get('x-trace')).toBe('req-2')
  })

  it('strips injected headers and sets final headers last', () => {
    const headers = Object.fromEntries(NEXTJS_INTERNAL_HEADERS_TO_STRIP.map((name) => [name, '1']))
    const request = buildOriginRequest(incoming('/', { ...headers, 'x-user-id': '7' }), {
      origin: ORIGIN,
      stripHeaders: [...NEXTJS_INTERNAL_HEADERS_TO_STRIP, 'x-user-id'],
      setHeaders: { 'x-gpc': '1' },
    })
    for (const name of NEXTJS_INTERNAL_HEADERS_TO_STRIP)
      expect(request.headers.has(name)).toBe(false)
    expect(request.headers.has('x-user-id')).toBe(false)
    expect(request.headers.get('x-gpc')).toBe('1')
  })

  it('forces identity encoding for local origins, on request, and by configured host', () => {
    const headers = { 'accept-encoding': 'gzip' }
    const encoding = (origin: string, extra = {}) =>
      buildOriginRequest(incoming('/', headers), { origin, ...extra }).headers.get(
        'accept-encoding',
      )
    expect(encoding(ORIGIN)).toBe('gzip')
    expect(encoding('http://localhost:3000')).toBe('identity')
    expect(encoding('http://127.0.0.1:3000')).toBe('identity')
    expect(encoding(ORIGIN, { forceIdentityEncoding: true })).toBe('identity')
    expect(encoding(ORIGIN, { identityEncodingHostnames: ['origin.internal'] })).toBe('identity')
  })

  it('streams bodies for mutating methods only', async () => {
    const post = buildOriginRequest(incoming('/', {}, { method: 'POST', body: 'payload' }), {
      origin: ORIGIN,
    })
    expect(await post.text()).toBe('payload')
    const get = buildOriginRequest(incoming('/'), { origin: ORIGIN })
    expect(get.body).toBeNull()
    const head = buildOriginRequest(incoming('/', {}, { method: 'HEAD' }), { origin: ORIGIN })
    expect(head.method).toBe('HEAD')
  })
})

describe('fetchOriginResponse', () => {
  const lost = () => new Error('Network connection lost.')

  it('returns the response and duration', async () => {
    const result = await fetchOriginResponse(incoming('/'), {
      fetch: async () => new Response('ok'),
    })
    expect('response' in result && (await result.response.text())).toBe('ok')
    expect('duration' in result && result.duration).toBeGreaterThanOrEqual(0)
  })

  it('uses global fetch by default', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('global'))
    const result = await fetchOriginResponse(incoming('/'))
    expect('response' in result && (await result.response.text())).toBe('global')
    spy.mockRestore()
  })

  it('retries idempotent requests once after a dropped socket', async () => {
    const send = vi.fn().mockRejectedValueOnce(lost()).mockResolvedValueOnce(new Response('second'))
    const result = await fetchOriginResponse(incoming('/'), { fetch: send })
    expect('response' in result && (await result.response.text())).toBe('second')
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('returns a 502 after a failed retry and reports the error', async () => {
    const send = vi.fn().mockRejectedValue(lost())
    const onError = vi.fn()
    const result = await fetchOriginResponse(incoming('/'), { fetch: send, onError })
    expect('error' in result && result.error.status).toBe(502)
    expect(send).toHaveBeenCalledTimes(2)
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('does not retry mutating methods or unrelated errors', async () => {
    const send = vi.fn().mockRejectedValue(lost())
    const post = incoming('/', {}, { method: 'POST', body: 'x' })
    expect('error' in (await fetchOriginResponse(post, { fetch: send }))).toBe(true)
    expect(send).toHaveBeenCalledTimes(1)
    const other = vi.fn().mockRejectedValue(new Error('boom'))
    expect('error' in (await fetchOriginResponse(incoming('/'), { fetch: other }))).toBe(true)
    expect(other).toHaveBeenCalledTimes(1)
    const nonError = vi.fn().mockRejectedValue('lost')
    expect('error' in (await fetchOriginResponse(incoming('/'), { fetch: nonError }))).toBe(true)
    expect(nonError).toHaveBeenCalledTimes(1)
  })

  it('accepts a custom retry predicate', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(new Response('ok'))
    const result = await fetchOriginResponse(incoming('/'), {
      fetch: send,
      isRetryable: () => true,
    })
    expect('response' in result).toBe(true)
  })
})

describe('client info', () => {
  const policy = {
    requestKindHeader: 'x-kind',
    clientInfoHeaderNames: ['x-client', 'x-platform', 'x-version'],
    webClientHeader: { name: 'x-client', value: 'web' },
    webClientHeaders: { 'x-client': 'web', 'x-platform': 'web', 'x-version': 'dev' },
  }
  const options = { method: 'GET', requestOrigin: 'https://example.com' }
  const apply = (headers: Headers, extra = {}) =>
    applyClientInfoHeaders(headers, policy, { ...options, ...extra })

  it('detects fetch metadata', () => {
    expect(hasBrowserFetchMetadata(new Headers())).toBe(false)
    expect(hasBrowserFetchMetadata(new Headers({ 'sec-fetch-mode': 'cors' }))).toBe(true)
  })

  it('classifies top-level navigations and same-origin fetches', () => {
    const navigate = new Headers({ 'sec-fetch-mode': 'Navigate', 'sec-fetch-dest': 'document' })
    expect(isWebBrowserRequest(navigate, options)).toBe(true)
    expect(isWebBrowserRequest(navigate, { ...options, method: 'POST' })).toBe(false)
    const sameOrigin = (extra: Record<string, string>) =>
      isWebBrowserRequest(new Headers({ 'sec-fetch-site': 'same-origin', ...extra }), options)
    expect(sameOrigin({})).toBe(true)
    expect(sameOrigin({ origin: 'https://example.com', referer: 'https://example.com/a' })).toBe(
      true,
    )
    expect(sameOrigin({ origin: 'null' })).toBe(true)
    expect(sameOrigin({ origin: 'https://evil.test' })).toBe(false)
    expect(sameOrigin({ origin: 'garbage' })).toBe(false)
    expect(sameOrigin({ referer: 'https://evil.test/a' })).toBe(false)
    const crossSite = new Headers({ 'sec-fetch-site': 'cross-site' })
    expect(isWebBrowserRequest(crossSite, options)).toBe(false)
    expect(isWebBrowserRequest(new Headers(), options)).toBe(false)
  })

  it('marks synthetic traffic and clears client claims', () => {
    const headers = new Headers({ 'x-client': 'web', 'x-kind': 'forged', 'x-version': '1' })
    apply(headers, { requestKind: 'bot' })
    expect([...headers.entries()]).toEqual([['x-kind', 'bot']])
  })

  it('drops forged web claims without browser evidence and keeps other clients', () => {
    const forged = new Headers({ 'x-client': 'web', 'x-version': '1' })
    apply(forged)
    expect([...forged.keys()]).toEqual([])
    const native = new Headers({ 'x-client': 'ios', 'x-version': '1', 'x-kind': 'bot' })
    apply(native)
    expect(native.get('x-client')).toBe('ios')
    expect(native.has('x-kind')).toBe(false)
  })

  it('sets web headers only with matching browser evidence', () => {
    const web = new Headers({ 'sec-fetch-site': 'same-origin', 'x-client': 'ios' })
    apply(web)
    expect(web.get('x-client')).toBe('web')
    expect(web.get('x-version')).toBe('dev')
    const cross = new Headers({ 'sec-fetch-site': 'cross-site', 'x-client': 'web' })
    apply(cross)
    expect(cross.has('x-client')).toBe(false)
  })
})
