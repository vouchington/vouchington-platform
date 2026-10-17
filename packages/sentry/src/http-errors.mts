import { stripUrlQueryAndFragment } from '@vouchington/utils/observability'

/** HTTP failure classes with stable `code` and `status`. Messages omit the URL query and fragment. */
export class HttpRateLimitError extends Error {
  readonly code = 'HTTP_RATE_LIMIT'
  readonly status: number
  readonly retryAfterMs: number | null

  constructor(url: string, status: number, retryAfterMs: number | null) {
    super(
      `Rate limited for ${stripUrlQueryAndFragment(url)}` +
        (retryAfterMs === null ? '' : `, retry after ${retryAfterMs}ms`),
    )
    this.name = 'HttpRateLimitError'
    this.status = status
    this.retryAfterMs = retryAfterMs
  }
}

export class HttpServerError extends Error {
  readonly code = 'HTTP_SERVER_ERROR'
  readonly status: number

  constructor(url: string, status: number) {
    super(`Server error ${status} for ${stripUrlQueryAndFragment(url)}`)
    this.name = 'HttpServerError'
    this.status = status
  }
}

export class HttpResponseSizeError extends Error {
  readonly code = 'HTTP_RESPONSE_SIZE_EXCEEDED'
  readonly status = 413
  readonly actualSize: number
  readonly maxSize: number

  constructor(url: string, actualSize: number, maxSize: number) {
    super(
      `Response size exceeded limit: ${actualSize} > ${maxSize} bytes for ${stripUrlQueryAndFragment(url)}`,
    )
    this.name = 'HttpResponseSizeError'
    this.actualSize = actualSize
    this.maxSize = maxSize
  }
}

export class HttpNoBodyError extends Error {
  readonly code = 'HTTP_NO_BODY'
  readonly status = 502

  constructor(url: string) {
    super(`No response body for ${stripUrlQueryAndFragment(url)}`)
    this.name = 'HttpNoBodyError'
  }
}
