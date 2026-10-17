import { describe, expect, it } from 'vitest'
import {
  NO_STORE_HEADERS,
  edgeErrorResponse,
  withFailureNoStoreHeaders,
} from './error-response.mts'
import { appendHeaders, copyHeaders, deleteHeaders, withHeaders } from './headers.mts'
import {
  BASE_SECURITY_HEADERS,
  addSecurityHeaders,
  buildHsts,
  buildSecurityHeaders,
} from './security-headers.mts'

function responseWithCookies(): Response {
  const headers = new Headers({ 'x-keep': '1' })
  headers.append('set-cookie', 'a=1')
  headers.append('set-cookie', 'b=2')
  return new Response('body', { status: 201, statusText: 'Created', headers })
}

describe('headers', () => {
  it('copies repeated set-cookie headers', () => {
    expect(copyHeaders(responseWithCookies().headers).getSetCookie()).toEqual(['a=1', 'b=2'])
  })

  it('sets headers while preserving cookies, status, and body', async () => {
    const result = withHeaders(responseWithCookies(), { 'x-keep': '2', 'x-new': 'n' })
    expect(result.headers.get('x-keep')).toBe('2')
    expect(result.headers.get('x-new')).toBe('n')
    expect(result.headers.getSetCookie()).toEqual(['a=1', 'b=2'])
    expect(result.status).toBe(201)
    expect(result.statusText).toBe('Created')
    expect(await result.text()).toBe('body')
  })

  it('appends headers after existing values', () => {
    const result = appendHeaders(responseWithCookies(), [
      ['set-cookie', 'c=3'],
      ['x-keep', '2'],
    ])
    expect(result.headers.getSetCookie()).toEqual(['a=1', 'b=2', 'c=3'])
    expect(result.headers.get('x-keep')).toBe('1, 2')
  })

  it('deletes named headers in place', () => {
    const headers = new Headers({ a: '1', b: '2', c: '3' })
    deleteHeaders(headers, ['a', 'c'])
    expect([...headers.keys()]).toEqual(['b'])
  })
})

describe('error responses', () => {
  it('serializes a no-store JSON error', async () => {
    const response = edgeErrorResponse(429, 'Slow down', 'RATE_LIMIT', { 'retry-after': '60' })
    expect(response.status).toBe(429)
    expect(await response.json()).toEqual({ message: 'Slow down', code: 'RATE_LIMIT' })
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(response.headers.get('retry-after')).toBe('60')
    expect(response.headers.get('cache-control')).toBe(NO_STORE_HEADERS['cache-control'])
  })

  it('does not let callers weaken no-store headers', () => {
    const response = edgeErrorResponse(500, 'x', 'X', { 'cache-control': 'public' })
    expect(response.headers.get('cache-control')).toBe(NO_STORE_HEADERS['cache-control'])
  })

  it('leaves successes and redirects unchanged', () => {
    const ok = new Response('ok')
    const redirect = new Response(null, { status: 302 })
    expect(withFailureNoStoreHeaders(ok)).toBe(ok)
    expect(withFailureNoStoreHeaders(redirect)).toBe(redirect)
  })

  it('adds no-store headers to failures and keeps cookies', () => {
    const failure = new Response('no', { status: 503, headers: { 'set-cookie': 'a=1' } })
    const result = withFailureNoStoreHeaders(failure)
    expect(result.headers.get('cloudflare-cdn-cache-control')).toBe('no-store')
    expect(result.headers.getSetCookie()).toEqual(['a=1'])
  })
})

describe('security headers', () => {
  it('builds HSTS with and without preload', () => {
    expect(buildHsts()).toBe('max-age=63072000; includeSubDomains')
    expect(buildHsts(true)).toBe('max-age=63072000; includeSubDomains; preload')
  })

  it('applies the base set without HSTS or CSP by default', () => {
    const headers = buildSecurityHeaders(new Response())
    expect(headers).toEqual(BASE_SECURITY_HEADERS)
    expect(headers['permissions-policy']).toContain('camera=()')
  })

  it('adds HSTS in production and honors preload', () => {
    const production = buildSecurityHeaders(new Response(), { production: true })
    expect(production['strict-transport-security']).toBe(buildHsts(false))
    const preload = buildSecurityHeaders(new Response(), { production: true, hstsPreload: true })
    expect(preload['strict-transport-security']).toBe(buildHsts(true))
  })

  it('adds CSP and opener policy only when supplied', () => {
    const headers = buildSecurityHeaders(new Response(), {
      csp: "default-src 'self'",
      openerPolicy: 'unsafe-none',
    })
    expect(headers['content-security-policy']).toBe("default-src 'self'")
    expect(headers['cross-origin-opener-policy']).toBe('unsafe-none')
  })

  it('preserves an origin no-referrer policy only when asked', () => {
    const origin = new Response(null, { headers: { 'referrer-policy': 'origin, No-Referrer' } })
    const other = new Response(null, { headers: { 'referrer-policy': 'unsafe-url' } })
    const absent = new Response()
    const optIn = { preserveOriginNoReferrer: true }
    expect(buildSecurityHeaders(origin, optIn)['referrer-policy']).toBe('no-referrer')
    expect(buildSecurityHeaders(other, optIn)['referrer-policy']).toBe(
      'strict-origin-when-cross-origin',
    )
    expect(buildSecurityHeaders(absent, optIn)['referrer-policy']).toBe(
      'strict-origin-when-cross-origin',
    )
    expect(buildSecurityHeaders(origin)['referrer-policy']).toBe('strict-origin-when-cross-origin')
  })

  it('accepts a replacement base set and final overrides', () => {
    const headers = buildSecurityHeaders(new Response(), {
      baseHeaders: { 'x-base': '1' },
      overrides: { 'x-base': '2', 'x-extra': '3' },
    })
    expect(headers).toEqual({ 'x-base': '2', 'x-extra': '3' })
  })

  it('overwrites origin headers and keeps set-cookie', () => {
    const origin = new Response('page', {
      headers: { 'x-frame-options': 'ALLOWALL', 'set-cookie': 'a=1' },
    })
    const result = addSecurityHeaders(origin)
    expect(result.headers.get('x-frame-options')).toBe('SAMEORIGIN')
    expect(result.headers.getSetCookie()).toEqual(['a=1'])
  })
})
