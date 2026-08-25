import { describe, expect, it } from 'vitest'
import {
  SENSITIVE_VALUE,
  composeBeforeSend,
  isAllowedEnvironment,
  scrubEvent,
  scrubHeaders,
  scrubSpanAttributes,
  stripUrlQueryAndFragment,
  shouldReportSpike,
} from './index.mts'

describe('observability scrubbing', () => {
  const options = { credentialHeaders: ['authorization', 'x-api-key'] }
  it('removes URL secrets and caller-defined credentials with copy-on-write behavior', () => {
    const event = {
      request: {
        url: 'https://example.test/a?token=x#y',
        query_string: 'token=x',
        headers: { Authorization: 'secret', Referer: 'https://ref.test/a?q=x' },
      },
      breadcrumbs: [{ data: { 'url.full': '/a?q=x', 'http.query': 'q=x' } }],
    }
    expect(scrubEvent(event, options)).toEqual({
      request: {
        url: 'https://example.test/a',
        headers: { Authorization: SENSITIVE_VALUE, Referer: 'https://ref.test/a' },
      },
      breadcrumbs: [{ data: { 'url.full': '/a' } }],
    })
    expect(scrubEvent({ message: 'safe' }, options)).toEqual({ message: 'safe' })
    expect(scrubHeaders({ Authorization: 'x', x: 'y' }, ['authorization'])).toEqual({
      Authorization: SENSITIVE_VALUE,
      x: 'y',
    })
  })
  it('scrubs URL and credential span attributes and composes hooks', async () => {
    expect(
      scrubSpanAttributes(
        { url: '/a?q=x', 'http.query': 'q=x', 'http.request.header.x-api-key': 'secret' },
        options,
      ),
    ).toEqual({ url: '/a', 'http.request.header.x-api-key': SENSITIVE_VALUE })
    expect(stripUrlQueryAndFragment('relative?a#b')).toBe('relative')
    expect(
      composeBeforeSend(undefined, options)({ request: { headers: { 'X-Api-Key': 'x' } } }, {}),
    ).toEqual({ request: { headers: { 'X-Api-Key': SENSITIVE_VALUE } } })
    await expect(composeBeforeSend(async () => null, options)({}, {})).resolves.toBeNull()
    await expect(composeBeforeSend(async (input) => input, options)({}, {})).resolves.toEqual({})
    const event = { breadcrumbs: [{ data: { url: '/a?q=x' } }] }
    expect(scrubEvent(event, options)).toEqual({ breadcrumbs: [{ data: { url: '/a' } }] })
  })
  it('keeps environment and spike policy caller-owned', () => {
    expect(isAllowedEnvironment('production', ['production'])).toBe(true)
    expect(isAllowedEnvironment(undefined, ['production'])).toBe(false)
    expect(shouldReportSpike(2, 2)).toBe(true)
    expect(shouldReportSpike(Number.NaN, 2)).toBe(false)
  })
  it('keeps unchanged records by identity and supports synchronous hook outcomes', () => {
    const event = { request: { headers: 'not-a-record', url: '/safe' }, breadcrumbs: [{}] }
    expect(scrubEvent(event, options)).toBe(event)
    const attributes = { url: 1, safe: true }
    expect(scrubSpanAttributes(attributes, options)).toBe(attributes)
    expect(scrubEvent({ request: { url: 1 } }, options)).toEqual({ request: { url: 1 } })
    expect(composeBeforeSend(() => null, options)({}, {})).toBeNull()
    expect(composeBeforeSend((input) => input, options)(event, {})).toBe(event)
  })
})
