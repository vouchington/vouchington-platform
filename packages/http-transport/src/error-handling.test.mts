import { describe, expect, it, vi } from 'vitest'
import {
  cancelResponseBody,
  handleHttpErrors,
  HttpRateLimitError,
  HttpServerError,
  isDnsLookupError,
  isNetworkError,
  isRetryableError,
  isTimeoutError,
  isTlsHostnameMismatchError,
} from './fetch.mts'

function namedError(name: string, code?: string): Error {
  const error = new Error(name, code ? { cause: Object.assign(new Error('x'), { code }) } : {})
  error.name = name
  return error
}

describe('predicates', () => {
  it('accepts both AbortError and TimeoutError as timeouts', () => {
    expect(isTimeoutError(namedError('AbortError'))).toBe(true)
    expect(isTimeoutError(namedError('TimeoutError'))).toBe(true)
    expect(isTimeoutError(namedError('TypeError'))).toBe(false)
    expect(isTimeoutError('AbortError')).toBe(false)
  })

  it('classifies timeouts and known socket codes as network errors', () => {
    expect(isNetworkError(namedError('TimeoutError'))).toBe(true)
    expect(isNetworkError(namedError('Error', 'ECONNRESET'))).toBe(true)
    expect(isNetworkError(namedError('Error', 'EACCES'))).toBe(false)
    expect(isNetworkError(namedError('AbortError'))).toBe(false)
    expect(isNetworkError()).toBe(false)
  })

  it('retries 5xx statuses and network errors only', () => {
    expect(isRetryableError(undefined, 503)).toBe(true)
    expect(isRetryableError(undefined, 404)).toBe(false)
    expect(isRetryableError(undefined, 600)).toBe(false)
    expect(isRetryableError(namedError('TimeoutError'), 404)).toBe(true)
    expect(isRetryableError(new Error('boom'))).toBe(false)
  })

  it('classifies DNS lookup failures across cause chains and handles cycles', () => {
    const nullRoute = Object.assign(new Error('resolved to ::'), { code: 'DNS_NULL_ROUTE' })
    expect(isDnsLookupError(new Error('outer', { cause: nullRoute }))).toBe(true)

    const enotfound = Object.assign(new Error('lookup failed'), { code: 'ENOTFOUND' })
    expect(isDnsLookupError(enotfound)).toBe(true)
    expect(isDnsLookupError(new TypeError('fetch failed', { cause: enotfound }))).toBe(true)

    expect(isDnsLookupError(new Error('getaddrinfo EAI_FAIL example.test'))).toBe(true)
    expect(
      isDnsLookupError(new Error('outer', { cause: new Error('ENOTFOUND example.test') })),
    ).toBe(true)

    // A wrapper message containing a hostname does not override a non-DNS cause.
    expect(
      isDnsLookupError(
        new Error('failed fetching https://enotfound.example', {
          cause: new Error('connect ECONNRESET'),
        }),
      ),
    ).toBe(false)

    const missingMessage = new Error('placeholder')
    Object.defineProperty(missingMessage, 'message', { value: undefined })
    expect(isDnsLookupError(new Error('outer', { cause: missingMessage }))).toBe(false)

    const circular: Error & { cause?: unknown } = new Error('circular')
    circular.cause = circular
    expect(isDnsLookupError(circular)).toBe(false)
    expect(isDnsLookupError('not an error')).toBe(false)
  })

  it('classifies TLS hostname mismatches across cause chains and handles cycles', () => {
    const mismatch = Object.assign(new Error('altname mismatch'), {
      code: 'ERR_TLS_CERT_ALTNAME_INVALID',
    })
    expect(isTlsHostnameMismatchError(mismatch)).toBe(true)
    expect(isTlsHostnameMismatchError(new TypeError('fetch failed', { cause: mismatch }))).toBe(
      true,
    )

    const expired = Object.assign(new Error('expired'), { code: 'CERT_HAS_EXPIRED' })
    expect(isTlsHostnameMismatchError(new TypeError('fetch failed', { cause: expired }))).toBe(
      false,
    )

    const circular: Error & { cause?: unknown } = new Error('circular')
    circular.cause = circular
    expect(isTlsHostnameMismatchError(circular)).toBe(false)
    expect(isTlsHostnameMismatchError(null)).toBe(false)
  })
})

describe('cancelResponseBody', () => {
  it('cancels the body and reports a failed cancellation without throwing', async () => {
    const onError = vi.fn()
    const failure = new Error('cancel failed')
    const cancel = vi.fn().mockRejectedValue(failure)
    cancelResponseBody({ body: { cancel } }, onError)
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(failure))
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('ignores responses without a body', () => {
    const onError = vi.fn()
    cancelResponseBody({ body: null }, onError)
    cancelResponseBody({}, onError)
    expect(onError).not.toHaveBeenCalled()
  })
})

describe('handleHttpErrors', () => {
  const url = 'https://example.test/feed'
  const onError = vi.fn()

  it('returns for non-error statuses and redirects', () => {
    for (const status of [200, 301, 404]) {
      expect(() =>
        handleHttpErrors({ response: new Response(null, { status }), url, onError }),
      ).not.toThrow()
    }
  })

  it('accepts any response with status, headers, and a cancellable body', () => {
    const response = { status: 503, headers: new Headers(), body: null }
    expect(catchError(() => handleHttpErrors({ response, url, onError }))).toBeInstanceOf(
      HttpServerError,
    )
  })

  it('throws HttpRateLimitError with the parsed Retry-After seconds', () => {
    const response = new Response('slow down', { status: 429, headers: { 'retry-after': '7' } })
    const thrown = catchError(() => handleHttpErrors({ response, url, onError }))
    expect(thrown).toBeInstanceOf(HttpRateLimitError)
    expect(thrown).toMatchObject({
      url,
      status: 429,
      retryAfterMs: 7000,
      name: 'HttpRateLimitError',
    })
  })

  it('reports a null delay when Retry-After is absent or invalid', () => {
    for (const headers of [{}, { 'retry-after': 'soon' }]) {
      const response = new Response(null, { status: 429, headers })
      expect(catchError(() => handleHttpErrors({ response, url, onError }))).toMatchObject({
        retryAfterMs: null,
      })
    }
  })

  it('throws HttpServerError for 5xx and cancels the body', () => {
    const response = new Response('oops', { status: 502 })
    const cancel = vi.spyOn(response.body!, 'cancel')
    const thrown = catchError(() => handleHttpErrors({ response, url, onError }))
    expect(thrown).toBeInstanceOf(HttpServerError)
    expect(thrown).toMatchObject({ url, status: 502, name: 'HttpServerError' })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('lets callers inject their own error classes', () => {
    class Limited extends Error {}
    class Broken extends Error {}
    const createRateLimitError = vi.fn(() => new Limited('limited'))
    const createServerError = vi.fn(() => new Broken('broken'))
    const options = { url, onError, createRateLimitError, createServerError }

    const limited = new Response(null, { status: 429, headers: { 'retry-after': '1' } })
    expect(catchError(() => handleHttpErrors({ ...options, response: limited }))).toBeInstanceOf(
      Limited,
    )
    expect(createRateLimitError).toHaveBeenCalledWith(url, 429, 1000)

    const broken = new Response(null, { status: 500 })
    expect(catchError(() => handleHttpErrors({ ...options, response: broken }))).toBeInstanceOf(
      Broken,
    )
    expect(createServerError).toHaveBeenCalledWith(url, 500)
  })
})

function catchError(run: () => void): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  throw new Error('expected a throw')
}
