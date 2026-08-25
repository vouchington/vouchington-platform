import type { Browser } from 'playwright-core'

export interface BrowserCrawlResult {
  statusCode: number
  hasContent: boolean
  title: string
  contentLength: number
  finalUrl: string
  html?: string
}

export interface BrowserCrawlRequest {
  url: string
  endpoint: string
  connect: (endpoint: string) => Promise<Browser>
  navigationTimeoutMs?: number
  hydrationWaitMs?: number
  minContentLength?: number
  maxHtmlBytes?: number
  /** Runs for every routable page request, regardless of URL scheme, and every WebSocket dial. */
  requestPolicy?: (url: string, kind: 'request' | 'websocket') => void | Promise<void>
  onCleanupError?: (error: unknown) => void
}

export interface BrowserCrawlErrorDetails {
  url: string
  cause: unknown
}

export class BrowserCrawlConnectError extends Error {
  constructor({ url, cause }: BrowserCrawlErrorDetails) {
    super(`Could not prepare browser crawl for ${url}`, { cause })
    this.name = 'BrowserCrawlConnectError'
  }
}

export class BrowserCrawlNavigationError extends Error {
  constructor({ url, cause }: BrowserCrawlErrorDetails) {
    super(`Could not navigate browser crawl to ${url}`, { cause })
    this.name = 'BrowserCrawlNavigationError'
  }
}

export class BrowserCrawlTimeoutError extends BrowserCrawlNavigationError {
  readonly timeoutMs: number

  constructor({ url, cause }: BrowserCrawlErrorDetails, timeoutMs: number) {
    super({ url, cause })
    this.name = 'BrowserCrawlTimeoutError'
    this.timeoutMs = timeoutMs
  }
}
