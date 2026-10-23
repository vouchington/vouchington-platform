export class HttpRateLimitError extends Error {
  readonly url: string
  readonly status: number
  readonly retryAfterMs: number | null

  constructor(url: string, status: number, retryAfterMs: number | null) {
    super(`HTTP ${status} rate limited: ${url}`)
    this.name = 'HttpRateLimitError'
    this.url = url
    this.status = status
    this.retryAfterMs = retryAfterMs
  }
}

export class HttpServerError extends Error {
  readonly url: string
  readonly status: number

  constructor(url: string, status: number) {
    super(`HTTP ${status} server error: ${url}`)
    this.name = 'HttpServerError'
    this.url = url
    this.status = status
  }
}
