/** HTTP failure classes with stable `code` and `status` fields for event filtering and retry. */
export class HttpRateLimitError extends Error {
  readonly code = 'HTTP_RATE_LIMIT'
  readonly status: number
  readonly retryAfterMs: number | null

  constructor(url: string, status: number, retryAfterMs: number | null) {
    super(`Rate limited for ${url}, retry after ${retryAfterMs}ms`)
    this.name = 'HttpRateLimitError'
    this.status = status
    this.retryAfterMs = retryAfterMs
  }
}

export class HttpServerError extends Error {
  readonly code = 'HTTP_SERVER_ERROR'
  readonly status: number

  constructor(url: string, status: number) {
    super(`Server error ${status} for ${url}`)
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
    super(`Response size exceeded limit: ${actualSize} > ${maxSize} bytes for ${url}`)
    this.name = 'HttpResponseSizeError'
    this.actualSize = actualSize
    this.maxSize = maxSize
  }
}

export class HttpNoBodyError extends Error {
  readonly code = 'HTTP_NO_BODY'
  readonly status = 502

  constructor(url: string) {
    super(`No response body for ${url}`)
    this.name = 'HttpNoBodyError'
  }
}
