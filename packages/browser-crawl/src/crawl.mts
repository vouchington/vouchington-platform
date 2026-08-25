import type { Browser, BrowserContext } from 'playwright-core'

import {
  BrowserCrawlConnectError,
  BrowserCrawlNavigationError,
  BrowserCrawlTimeoutError,
  type BrowserCrawlRequest,
  type BrowserCrawlResult,
} from './types.mts'

const DEFAULT_NAVIGATION_TIMEOUT_MS = 30_000
const DEFAULT_MIN_CONTENT_LENGTH = 50
const DEFAULT_MAX_HTML_BYTES = 4 * 1024 * 1024

export async function crawlWithBrowser(request: BrowserCrawlRequest): Promise<BrowserCrawlResult> {
  const options = normalizeRequest(request)
  let browser: Browser | undefined
  let context: BrowserContext | undefined
  let page: Awaited<ReturnType<BrowserContext['newPage']>> | undefined
  let navigationPolicyError: unknown
  try {
    try {
      browser = await options.connect(options.endpoint)
      context = await browser.newContext({ serviceWorkers: 'block' })
      page = await context.newPage()
      page.setDefaultTimeout(options.navigationTimeoutMs)
      await installRequestPolicy(page, options.requestPolicy, (error) => {
        navigationPolicyError = error
      })
    } catch (cause) {
      throw new BrowserCrawlConnectError({ url: options.url, cause })
    }
    let statusCode = 200
    try {
      const response = await page.goto(options.url, {
        waitUntil: 'load',
        timeout: options.navigationTimeoutMs,
      })
      if (response) statusCode = response.status()
    } catch (cause) {
      if (navigationPolicyError) throw navigationPolicyError
      if (isTimeoutError(cause)) {
        throw new BrowserCrawlTimeoutError({ url: options.url, cause }, options.navigationTimeoutMs)
      }
      throw new BrowserCrawlNavigationError({ url: options.url, cause })
    }
    if (options.hydrationWaitMs > 0) await delay(options.hydrationWaitMs)
    const title = await page.title()
    const contentLength = await page.evaluate(() => {
      const document = (globalThis as { document?: { body?: { innerText?: string } } }).document
      return document?.body?.innerText?.length ?? 0
    })
    const html = await getHtml(page, options.maxHtmlBytes)
    return {
      statusCode,
      title,
      contentLength,
      hasContent: title.trim().length > 0 || contentLength >= options.minContentLength,
      finalUrl: page.url(),
      ...(html === undefined ? {} : { html }),
    }
  } finally {
    await closeQuietly(page, options.onCleanupError)
    await closeQuietly(context, options.onCleanupError)
    await closeQuietly(browser, options.onCleanupError)
  }
}

function normalizeRequest(request: BrowserCrawlRequest) {
  if (!request.url) throw new TypeError('url is required')
  if (!request.endpoint) throw new TypeError('endpoint is required')
  return {
    ...request,
    navigationTimeoutMs: positiveInteger(
      request.navigationTimeoutMs,
      DEFAULT_NAVIGATION_TIMEOUT_MS,
    ),
    hydrationWaitMs: nonNegativeInteger(request.hydrationWaitMs, 0),
    minContentLength: nonNegativeInteger(request.minContentLength, DEFAULT_MIN_CONTENT_LENGTH),
    maxHtmlBytes: positiveInteger(request.maxHtmlBytes, DEFAULT_MAX_HTML_BYTES),
  }
}

async function installRequestPolicy(
  page: Awaited<ReturnType<BrowserContext['newPage']>>,
  policy: BrowserCrawlRequest['requestPolicy'],
  setNavigationError: (error: unknown) => void,
): Promise<void> {
  if (!policy) return
  await page.route('**/*', async (route) => {
    try {
      await policy(route.request().url(), 'request')
      await route.fallback()
    } catch (error) {
      if (route.request().isNavigationRequest()) setNavigationError(error)
      await route.abort('blockedbyclient')
    }
  })
  await page.routeWebSocket('**/*', async (route) => {
    try {
      await policy(route.url(), 'websocket')
      route.connectToServer()
    } catch {
      await route.close({ code: 1008, reason: 'blocked by client' })
    }
  })
}

async function getHtml(page: Awaited<ReturnType<BrowserContext['newPage']>>, maxBytes: number) {
  try {
    const html = await page.content()
    return Buffer.byteLength(html, 'utf8') <= maxBytes ? html : undefined
  } catch {
    return undefined
  }
}

async function closeQuietly(
  resource: { close(): Promise<void> } | undefined,
  onError?: (error: unknown) => void,
) {
  try {
    await resource?.close()
  } catch (error) {
    onError?.(error)
  }
}

function positiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new TypeError('Expected a positive safe integer')
  return value
}

function nonNegativeInteger(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 0)
    throw new TypeError('Expected a non-negative safe integer')
  return value
}

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'TimeoutError' || error.constructor.name === 'TimeoutError')
  )
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
