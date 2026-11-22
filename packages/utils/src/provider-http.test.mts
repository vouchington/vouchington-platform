import { describe, expect, it } from 'vitest'
import {
  callProviderJson,
  parseRetryAfterMs,
  providerFailure,
  type ProviderFetch,
} from './provider-http.mts'
import { fakeFetch, jsonResponse } from './provider-http-test-helpers.mts'

const init = { method: 'GET' as const }

describe('parseRetryAfterMs', () => {
  it('parses seconds, dates, and rejects unusable values', () => {
    expect(parseRetryAfterMs(null)).toBeNull()
    expect(parseRetryAfterMs('  ')).toBeNull()
    expect(parseRetryAfterMs('7')).toBe(7000)
    expect(parseRetryAfterMs('soon')).toBeNull()
    const now = Date.parse('2026-01-01T00:00:00Z')
    expect(parseRetryAfterMs('Thu, 01 Jan 2026 00:00:30 GMT', now)).toBe(30_000)
    expect(parseRetryAfterMs('Wed, 31 Dec 2025 00:00:00 GMT', now)).toBe(0)
    expect(parseRetryAfterMs('5')).toBe(5000)
  })
})

describe('providerFailure', () => {
  it('fills nullable fields', () => {
    expect(providerFailure('transport', true, 'm')).toEqual({
      kind: 'transport',
      retryable: true,
      message: 'm',
      status: null,
      retryAfterMs: null,
      cause: null,
    })
  })
})

describe('callProviderJson', () => {
  it('returns the parsed body and passes a signal', async () => {
    const { fetch, calls } = fakeFetch(() => jsonResponse({ a: 1 }))
    const result = await callProviderJson('X', 'https://x.test/', init, { fetch })
    expect(result).toEqual({ ok: true, body: { a: 1 } })
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal)
  })

  it('classifies transport errors as retryable', async () => {
    const cause = new Error('boom')
    const fetch: ProviderFetch = () => Promise.reject(cause)
    const result = await callProviderJson('X', 'https://x.test/', init, {
      fetch,
      signal: new AbortController().signal,
    })
    expect(result).toMatchObject({
      ok: false,
      failure: { kind: 'transport', retryable: true, cause },
    })
  })

  it('classifies a timeout as a retryable transport failure', async () => {
    const fetch: ProviderFetch = (_input, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason))
      })
    const result = await callProviderJson('X', 'https://x.test/', init, { fetch, timeoutMs: 5 })
    expect(result).toMatchObject({ ok: false, failure: { kind: 'transport', retryable: true } })
  })

  it('rethrows a caller abort from the transport', async () => {
    const controller = new AbortController()
    const fetch: ProviderFetch = () => {
      controller.abort()
      return Promise.reject(new Error('aborted'))
    }
    await expect(
      callProviderJson('X', 'https://x.test/', init, { fetch, signal: controller.signal }),
    ).rejects.toThrow('aborted')
  })

  it('rethrows a caller abort during body read', async () => {
    const controller = new AbortController()
    const response = new Response('{', { status: 200 })
    Object.defineProperty(response, 'json', {
      value: () => {
        controller.abort()
        return Promise.reject(new Error('body aborted'))
      },
    })
    await expect(
      callProviderJson('X', 'https://x.test/', init, {
        fetch: async () => response,
        signal: controller.signal,
      }),
    ).rejects.toThrow('body aborted')
  })

  it('classifies rate limits with Retry-After', async () => {
    const { fetch } = fakeFetch(
      () => new Response(null, { status: 429, headers: { 'retry-after': '3' } }),
    )
    expect(await callProviderJson('X', 'https://x.test/', init, { fetch })).toMatchObject({
      ok: false,
      failure: { kind: 'rate-limited', retryable: true, status: 429, retryAfterMs: 3000 },
    })
  })

  it('honors custom rate-limit statuses', async () => {
    const { fetch } = fakeFetch(() => new Response('no', { status: 403 }))
    const options = { fetch, rateLimitStatuses: [403] }
    expect(await callProviderJson('X', 'https://x.test/', init, options)).toMatchObject({
      failure: { kind: 'rate-limited' },
    })
    expect(await callProviderJson('X', 'https://x.test/', init, { fetch })).toMatchObject({
      failure: { kind: 'http', retryable: false, status: 403 },
    })
  })

  it.each([
    [408, true],
    [500, true],
    [503, true],
    [400, false],
    [404, false],
  ])('classifies HTTP %i as retryable=%s', async (status, retryable) => {
    const { fetch } = fakeFetch(() => new Response('x', { status }))
    expect(await callProviderJson('X', 'https://x.test/', init, { fetch })).toMatchObject({
      ok: false,
      failure: { kind: 'http', retryable, status },
    })
  })

  it('tolerates a body that cannot be cancelled', async () => {
    const response = new Response('x', { status: 500 })
    Object.defineProperty(response, 'body', {
      value: { cancel: () => Promise.reject(new Error('locked')) },
    })
    const result = await callProviderJson('X', 'https://x.test/', init, {
      fetch: async () => response,
    })
    expect(result).toMatchObject({ failure: { status: 500 } })
  })

  it('classifies invalid JSON as retryable', async () => {
    const { fetch } = fakeFetch(() => new Response('<html>', { status: 200 }))
    expect(await callProviderJson('X', 'https://x.test/', init, { fetch })).toMatchObject({
      ok: false,
      failure: { kind: 'invalid-json', retryable: true, status: 200 },
    })
  })
})
