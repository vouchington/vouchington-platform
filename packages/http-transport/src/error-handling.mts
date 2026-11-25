import { isRetryableNetworkError, parseRetryAfter } from '@jongleberry/api-server/http-retry'
import { HttpRateLimitError, HttpServerError } from './errors.mts'

export function isNetworkError(error?: unknown): boolean {
  return (error instanceof Error && error.name === 'TimeoutError') || isRetryableNetworkError(error)
}

/**
 * `AbortSignal.timeout()` aborts `fetch` with a `TimeoutError`; an aborted stream `pipeline` and
 * hand-rolled `AbortController.abort()` sites surface `AbortError`. Accept both names.
 */
export function isTimeoutError(error: unknown): error is Error {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
}

/** True for any 5xx status or a retryable network error. */
export function isRetryableError(error: unknown, status?: number): boolean {
  if (status !== undefined && status >= 500 && status < 600) return true
  return isNetworkError(error)
}

/**
 * True when the error or its cause chain represents a DNS lookup failure (`ENOTFOUND`,
 * `DNS_NULL_ROUTE`, or a cause/leaf message referencing `enotfound` / `getaddrinfo`).
 */
export function isDnsLookupError(error: unknown): boolean {
  let current: unknown = error
  const visited = new Set<unknown>()
  while (current instanceof Error && !visited.has(current)) {
    visited.add(current)
    const code = (current as Error & { code?: unknown }).code
    if (code === 'DNS_NULL_ROUTE' || code === 'ENOTFOUND') return true
    const nextCause = (current as Error & { cause?: unknown }).cause
    if (current !== error || !(nextCause instanceof Error)) {
      const message = typeof current.message === 'string' ? current.message.toLowerCase() : ''
      if (message.includes('enotfound') || message.includes('getaddrinfo')) return true
    }
    current = nextCause
  }
  return false
}

/**
 * True when the error or its cause chain represents a TLS certificate hostname mismatch
 * (`ERR_TLS_CERT_ALTNAME_INVALID`).
 */
export function isTlsHostnameMismatchError(error: unknown): boolean {
  let current: unknown = error
  const visited = new Set<unknown>()
  while (current instanceof Error && !visited.has(current)) {
    visited.add(current)
    if ((current as Error & { code?: unknown }).code === 'ERR_TLS_CERT_ALTNAME_INVALID') {
      return true
    }
    current = (current as Error & { cause?: unknown }).cause
  }
  return false
}

/** Best-effort body cleanup. A failed cancellation is reported, never thrown. */
export function cancelResponseBody(
  response: { body?: { cancel(): Promise<void> } | null },
  onError: (error: unknown) => void,
): void {
  const cancellation = response.body?.cancel()
  if (cancellation) void cancellation.catch(onError)
}

/** The response members `handleHttpErrors` reads; global and undici responses both fit. */
export interface HttpErrorResponse {
  readonly status: number
  readonly headers: { get(name: string): string | null }
  readonly body?: { cancel(): Promise<void> } | null
}

export interface HandleHttpErrorsOptions {
  response: HttpErrorResponse
  url: string
  /** Receives body-cancellation failures; the HTTP error outcome is preserved. */
  onError: (error: unknown) => void
  /** Replaces the thrown `HttpRateLimitError`. `retryAfterMs` is null when absent or invalid. */
  createRateLimitError?: (url: string, status: number, retryAfterMs: number | null) => Error
  /** Replaces the thrown `HttpServerError`. */
  createServerError?: (url: string, status: number) => Error
}

const defaultRateLimitError = (url: string, status: number, retryAfterMs: number | null) =>
  new HttpRateLimitError(url, status, retryAfterMs)
const defaultServerError = (url: string, status: number) => new HttpServerError(url, status)

/** Throws for 429 (with the parsed `Retry-After` delay) and for 5xx; otherwise returns. */
export function handleHttpErrors(options: HandleHttpErrorsOptions): void {
  const { response, url, onError } = options
  if (response.status === 429) {
    cancelResponseBody(response, onError)
    const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'))
    throw (options.createRateLimitError ?? defaultRateLimitError)(
      url,
      response.status,
      retryAfterMs,
    )
  }
  if (response.status >= 500) {
    cancelResponseBody(response, onError)
    throw (options.createServerError ?? defaultServerError)(url, response.status)
  }
}
