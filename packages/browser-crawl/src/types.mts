import type { Browser, Page } from 'playwright-core'

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
  /** Omit `html` when the serialized document exceeds this many UTF-8 bytes. Default 4 MiB. */
  maxHtmlBytes?: number
  /** Truncate the title to this many UTF-8 bytes. Default 16 KiB. */
  maxTitleBytes?: number
  /**
   * Stop walking the DOM after this many nodes and characters. The crawl then omits `html` and
   * reports `contentLength` as `minContentLength`. Default 4 Mi.
   */
  maxTraversalWork?: number
  /**
   * Runs once on the new page before `requestPolicy` is installed, for example to enable an ad
   * blocker's own request routes. Playwright runs the most recently registered route first, so
   * `requestPolicy` still sees every request, and the routes added here see only the requests it
   * allows. A rejection fails the crawl with `BrowserCrawlConnectError`.
   */
  preparePage?: (page: Page) => void | Promise<void>
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
