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

/** Best-effort body cleanup. A failed cancellation is reported, never thrown. */
export function cancelResponseBody(
  response: { body?: { cancel(): Promise<void> } | null },
  onError: (error: unknown) => void,
): void {
  const cancellation = response.body?.cancel()
  if (cancellation) void cancellation.catch(onError)
}

export interface HandleHttpErrorsOptions {
  response: Response
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
