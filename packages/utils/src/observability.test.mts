import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import {
  SENSITIVE_VALUE,
  composeBeforeSend,
  createSpikeWindowTracker,
  isAllowedEnvironment,
  scrubEvent,
  scrubHeaders,
  scrubSpanAttributes,
  shouldReportSpike,
  stripUrlQueryAndFragment,
} from './observability.mts'

describe('observability scrubbing', () => {
  const options = { credentialHeaders: ['Authorization', 'X-Api-Key'] }
  it('scrubs URL fields, configured credentials, and cookies without product defaults', () => {
    const event = {
      request: {
        url: 'https://example.test/a?token=x#y',
        query_string: 'token=x',
        headers: { Authorization: 'secret', Referer: 'https://ref.test/a?q=x' },
        cookies: { session: 'secret' },
      },
      breadcrumbs: [{ data: { 'url.full': '/a?q=x', 'http.query': 'q=x' } }],
    }
    expect(scrubEvent(event, options)).toEqual({
      request: {
        url: 'https://example.test/a',
        headers: { Authorization: SENSITIVE_VALUE, Referer: 'https://ref.test/a' },
        cookies: { session: SENSITIVE_VALUE },
      },
      breadcrumbs: [{ data: { 'url.full': '/a' } }],
    })
    expect(scrubHeaders({ Authorization: 'x', x: 'y' }, ['authorization'])).toEqual({
      Authorization: SENSITIVE_VALUE,
      x: 'y',
    })
    expect(
      scrubHeaders({ Referrer: ['https://a.test/?secret=1', 'https://b.test/#secret', 3] }, []),
    ).toEqual({ Referrer: ['https://a.test/', 'https://b.test/', 3] })
    expect(scrubHeaders({ Referer: 3 }, [])).toEqual({ Referer: 3 })
  })
  it('scrubs lowercase configured span keys plus referer and referrer attributes', () => {
    expect(
      scrubSpanAttributes(
        {
          'http.request.header.x-api-key': 'secret',
          'http.request.header.referer': 'https://ref.test/a?q=x',
          'http.request.header.referrer': 'https://ref.test/b#x',
          'http.query': 'q=x',
        },
        options,
      ),
    ).toEqual({
      'http.request.header.x-api-key': SENSITIVE_VALUE,
      'http.request.header.referer': 'https://ref.test/a',
      'http.request.header.referrer': 'https://ref.test/b',
    })
  })
  it('composes hook results and leaves policy caller-owned', async () => {
    expect(stripUrlQueryAndFragment('relative?a#b')).toBe('relative')
    expect(composeBeforeSend(() => null, options)({}, {})).toBeNull()
    await expect(composeBeforeSend(async () => null, options)({}, {})).resolves.toBeNull()
    await expect(composeBeforeSend(async (input) => input, options)({}, {})).resolves.toEqual({})
    const foreignPromise = runInNewContext('Promise.resolve({})') as Promise<
      Record<string, unknown>
    >
    await expect(composeBeforeSend(() => foreignPromise, options)({}, {})).resolves.toEqual({})
    expect(isAllowedEnvironment('production', ['production'])).toBe(true)
    expect(isAllowedEnvironment(undefined, ['production'])).toBe(false)
    expect(shouldReportSpike(2, 2)).toBe(true)
    expect(shouldReportSpike(Number.NaN, 2)).toBe(false)
  })
  it('keeps already-safe structures by identity while exercising all request shapes', () => {
    const event = {
      request: { headers: 'not-a-record', cookies: 'not-a-record', url: '/safe', value: true },
      breadcrumbs: [{}],
    }
    expect(scrubEvent(event, options)).toBe(event)
    const attributes = { url: 1, safe: true }
    expect(scrubSpanAttributes(attributes, options)).toBe(attributes)
    expect(scrubEvent({ request: { url: 1 } }, options)).toEqual({ request: { url: 1 } })
    expect(scrubEvent({ request: { headers: { Authorization: 'secret' } } }, options)).toEqual({
      request: { headers: { Authorization: SENSITIVE_VALUE } },
    })
    expect(scrubEvent({ breadcrumbs: [{ data: { url: '/a?q=x' } }] }, options)).toEqual({
      breadcrumbs: [{ data: { url: '/a' } }],
    })
    expect(composeBeforeSend(undefined, options)({}, {})).toEqual({})
    expect(composeBeforeSend((input) => input, options)(event, {})).toBe(event)
  })

  it('tracks spike windows independently and evicts expired fingerprints', () => {
    const tracker = createSpikeWindowTracker(1, 1_000)
    expect(tracker.recordAndCheck('a', 0)).toBe(true)
    expect(tracker.recordAndCheck('a', 1)).toBe(false)
    expect(tracker.recordAndCheck('b', 500)).toBe(true)
    expect(tracker.size).toBe(2)
    expect(tracker.recordAndCheck('c', 1_001)).toBe(true)
    expect(tracker.size).toBe(2)
    expect(tracker.recordAndCheck('c', 1_002)).toBe(false)
    expect(tracker.recordAndCheck('d', 2_001)).toBe(true)
    expect(tracker.size).toBe(1)
    expect(tracker.recordAndCheck('d', 0)).toBe(true)
    expect(tracker.size).toBe(1)
  })

  it('rejects spike settings that could prevent bounded eviction', () => {
    expect(() => createSpikeWindowTracker(Number.NaN, 1_000)).toThrow(RangeError)
    expect(() => createSpikeWindowTracker(-1, 1_000)).toThrow(RangeError)
    expect(() => createSpikeWindowTracker(1, Number.POSITIVE_INFINITY)).toThrow(RangeError)
    expect(() => createSpikeWindowTracker(1, 0)).toThrow(RangeError)
    const tracker = createSpikeWindowTracker(0, 1)
    expect(() => tracker.recordAndCheck('a', Number.NaN)).toThrow(RangeError)
    expect(tracker.recordAndCheck('a', 0)).toBe(false)
  })
})
