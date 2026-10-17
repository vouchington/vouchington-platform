import { describe, expect, it } from 'vitest'
import {
  SCRUBBED_URL_ATTRIBUTE_KEYS,
  SENSITIVE_VALUE,
  composeBeforeSend,
  dropRequestBody,
  dropSpanRequestBody,
  scrubBreadcrumbs,
  scrubCredentialHeaders,
  scrubEvent,
  scrubHeaders,
  scrubRequest,
  scrubRequestCredentialFields,
  scrubRequestUrlFields,
  scrubSpanAttributes,
  scrubSpanCredentialAttributes,
  scrubSpanUrlAttributes,
  scrubUrlValue,
} from './observability.mts'

const options = { credentialHeaders: ['authorization', 'x-api-key'] }
const redactUrl = (url: string) => url.replace(/(\/hooks\/)[^/]+(\/ping)/, '$1[REDACTED]$2')
const withRedaction = { ...options, redactUrl }

describe('copy-on-write identity', () => {
  it('keeps clean events, requests, headers, and breadcrumbs by identity', () => {
    const event = {
      request: { url: '/a', headers: { accept: 'x' }, cookies: {} },
      breadcrumbs: [{ data: { 'http.method': 'GET' } }],
    }
    expect(scrubEvent(event, options)).toBe(event)
    expect(scrubEvent(event, options).request).toBe(event.request)
    expect(scrubBreadcrumbs(event.breadcrumbs, options)).toBe(event.breadcrumbs)
    const headers = { accept: 'x', referer: ['/a', 3] }
    expect(scrubHeaders(headers, ['authorization'])).toBe(headers)
    const withNaN = { 'http.status_code': Number.NaN }
    expect(scrubSpanAttributes(withNaN, options)).toBe(withNaN)
    const nanReferer = { referer: ['/a', Number.NaN] }
    expect(scrubHeaders(nanReferer, [])).toBe(nanReferer)
    expect(scrubRequest(undefined, options)).toBeUndefined()
    expect(scrubBreadcrumbs(undefined, options)).toBeUndefined()
    expect(scrubBreadcrumbs([], options)).toEqual([])
  })

  it('replaces only the changed parts and keeps safe siblings', () => {
    const safe = { data: { 'http.method': 'GET' } }
    const noData: { message: string; data?: Record<string, unknown> } = { message: 'm' }
    const nullData = { data: null as unknown as Record<string, unknown> }
    const event = {
      id: 'e1',
      request: { headers: { accept: 'x' } },
      breadcrumbs: [safe, noData, nullData, { data: { url: '/a?q=1' } }],
    }
    const result = scrubEvent(event, options)
    expect(result.request).toBe(event.request)
    expect(result.breadcrumbs?.[0]).toBe(safe)
    expect(result.breadcrumbs?.[1]).toBe(noData)
    expect(result.breadcrumbs?.[2]).toBe(nullData)
    expect(result.breadcrumbs?.[3]).toEqual({ data: { url: '/a' } })
    expect(result.id).toBe('e1')
    const crumbsOnly = { request: event.request, breadcrumbs: [{ data: { url: '/a?q=1' } }] }
    const crumbResult = scrubEvent(crumbsOnly, options)
    expect(crumbResult.request).toBe(crumbsOnly.request)
    expect(crumbResult.breadcrumbs).toEqual([{ data: { url: '/a' } }])
    const requestOnly = scrubEvent({ request: { url: '/a?b' }, breadcrumbs: [safe] }, options)
    expect(requestOnly.request).toEqual({ url: '/a' })
  })
})

describe('adversarial keys', () => {
  it('keeps __proto__ and constructor as own data properties', () => {
    const data = Object.fromEntries([
      ['constructor', 'c'],
      ['__proto__', 'p'],
      ['url', '/a?token=x'],
    ])
    const result = scrubSpanAttributes(data, options)
    expect(Object.getOwnPropertyDescriptor(result, '__proto__')?.value).toBe('p')
    expect(result.constructor).toBe('c')
    expect(result.url).toBe('/a')
    const headers = Object.fromEntries([
      ['__proto__', 'p'],
      ['Authorization', 'secret'],
    ])
    const scrubbed = scrubCredentialHeaders(headers, ['authorization'])
    expect(Object.getOwnPropertyDescriptor(scrubbed, '__proto__')?.value).toBe('p')
    expect(scrubbed.Authorization).toBe(SENSITIVE_VALUE)
    const cookies = Object.fromEntries([['__proto__', 'p']])
    const request = scrubRequestCredentialFields({ cookies }, [])
    expect(Object.getOwnPropertyDescriptor(request?.cookies, '__proto__')?.value).toBe(
      SENSITIVE_VALUE,
    )
  })
})

describe('URL redaction hook', () => {
  const secretUrl = 'https://host.test/hooks/secret/ping?x=1#y'
  const redacted = 'https://host.test/hooks/[REDACTED]/ping'
  it('applies redactUrl after stripping every URL-bearing value', () => {
    expect(scrubSpanUrlAttributes({ 'url.full': secretUrl }, withRedaction)).toEqual({
      'url.full': redacted,
    })
    expect(scrubRequestUrlFields({ url: secretUrl, query_string: 'a' }, withRedaction)).toEqual({
      url: redacted,
    })
    expect(scrubHeaders({ Referer: [secretUrl, 3], referrer: secretUrl }, [], redactUrl)).toEqual({
      Referer: [redacted, 3],
      referrer: redacted,
    })
    expect(scrubEvent({ request: { url: secretUrl } }, withRedaction)).toEqual({
      request: { url: redacted },
    })
  })
  it('does nothing extra without a hook and passes non-strings through', () => {
    expect(scrubUrlValue('/a?b')).toBe('/a')
    expect(scrubUrlValue(7)).toBe(7)
    expect(scrubSpanUrlAttributes({ url: 1 })).toEqual({ url: 1 })
  })
  it('strips every item of a multi-value referer header', () => {
    expect(
      scrubRequestUrlFields({ headers: { Referer: ['/a?x', '/b#y'], other: ['/c?z'] } }),
    ).toEqual({ headers: { Referer: ['/a', '/b'], other: ['/c?z'] } })
  })
  it('exposes the scrubbed attribute key list', () => {
    expect(SCRUBBED_URL_ATTRIBUTE_KEYS).toHaveLength(10)
  })
})

describe('credential-only and url-only passes', () => {
  it('scrubs credential attributes without touching URLs', () => {
    const data = {
      'http.request.header.x_api_key': 'k',
      'http.request.header.cookie.sid': 'c',
      url: '/a?q=1',
    }
    expect(scrubSpanCredentialAttributes(data, ['X-Api-Key'])).toEqual({
      'http.request.header.x_api_key': SENSITIVE_VALUE,
      'http.request.header.cookie.sid': SENSITIVE_VALUE,
      url: '/a?q=1',
    })
    const safe = { 'http.request.header.x-api-key': SENSITIVE_VALUE }
    expect(scrubSpanCredentialAttributes(safe, ['x-api-key'])).toBe(safe)
  })
  it('scrubs request credentials and cookies but leaves URLs', () => {
    expect(
      scrubRequestCredentialFields(
        { url: '/a?q', headers: { Cookie: 'a', accept: 'x' }, cookies: { sid: 's' } },
        ['cookie'],
      ),
    ).toEqual({
      url: '/a?q',
      headers: { Cookie: SENSITIVE_VALUE, accept: 'x' },
      cookies: { sid: SENSITIVE_VALUE },
    })
    const filtered = { cookies: { sid: SENSITIVE_VALUE }, headers: 'raw' }
    expect(scrubRequestCredentialFields(filtered, [])).toBe(filtered)
    expect(scrubRequestCredentialFields(undefined, [])).toBeUndefined()
  })
})

describe('request body dropping', () => {
  it('drops bodies only when opted in', () => {
    const request = { url: '/a', data: { secret: 1 } }
    const span = { 'http.request.body.data': 'x', ok: 1 }
    expect(scrubRequest(request, options)).toBe(request)
    expect(scrubRequest(request, { ...options, dropRequestBody: true })).toEqual({ url: '/a' })
    expect(scrubSpanAttributes(span, options)).toBe(span)
    expect(scrubSpanAttributes(span, { ...options, dropRequestBody: true })).toEqual({ ok: 1 })
    const event = { breadcrumbs: [{ data: span }], request }
    expect(scrubEvent(event, { ...options, dropRequestBody: true })).toEqual({
      breadcrumbs: [{ data: { ok: 1 } }],
      request: { url: '/a' },
    })
  })
  it('exposes standalone drop helpers with identity on clean input', () => {
    const clean = { url: '/a' }
    expect(dropRequestBody(clean)).toBe(clean)
    expect(dropRequestBody(undefined)).toBeUndefined()
    const spanClean = { a: 1 }
    expect(dropSpanRequestBody(spanClean)).toBe(spanClean)
  })
})

describe('composeBeforeSend with a custom scrubber', () => {
  it('runs the supplied scrubber on sync and async results', async () => {
    type Event = { request?: object; tag: string }
    const mark = (event: Event): Event => ({ ...event, tag: 'scrubbed' })
    expect(composeBeforeSend<Event, unknown>(undefined, mark)({ tag: 'a' }, {})).toEqual({
      tag: 'scrubbed',
    })
    await expect(
      composeBeforeSend<Event, unknown>(async (event) => event, mark)({ tag: 'a' }, {}),
    ).resolves.toEqual({ tag: 'scrubbed' })
    expect(composeBeforeSend<Event, unknown>(() => null, mark)({ tag: 'a' }, {})).toBeNull()
    const thenableFunction = () => undefined
    Reflect.set(thenableFunction, 'then', (resolve: (value: Event) => void) =>
      resolve({ tag: 'late' }),
    )
    const hook = composeBeforeSend<Event, unknown>(() => thenableFunction as unknown as Event, mark)
    await expect(hook({ tag: 'a' }, {})).resolves.toEqual({ tag: 'scrubbed' })
  })
})
