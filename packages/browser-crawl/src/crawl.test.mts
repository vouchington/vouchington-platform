import type { Page } from 'playwright-core'
import { describe, expect, it, vi } from 'vitest'

import {
  BrowserCrawlConnectError,
  BrowserCrawlNavigationError,
  BrowserCrawlTimeoutError,
  crawlWithBrowser,
} from './index.mts'
import { measureAndSerializePage } from './page-content.mts'

describe('crawlWithBrowser', () => {
  it('collects rendered content and releases all browser resources', async () => {
    const fixture = browserFixture()
    const result = await crawlWithBrowser({
      url: 'https://example.test/original',
      endpoint: 'wss://browser.example.test',
      connect: fixture.connect,
      hydrationWaitMs: 1,
    })
    expect(result).toEqual({
      statusCode: 201,
      hasContent: true,
      title: 'Example',
      contentLength: 50,
      finalUrl: 'https://example.test/final',
      html: '<main>Example</main>',
    })
    expect(fixture.evaluate).toHaveBeenCalledWith(measureAndSerializePage, {
      maxContentLength: 50,
      maxHtmlBytes: 4 * 1024 * 1024,
      maxTitleBytes: 16 * 1024,
      maxTraversalWork: 4 * 1024 * 1024,
    })
    expect(fixture.newContext).toHaveBeenCalledWith({ serviceWorkers: 'block' })
    expect(fixture.setDefaultTimeout).toHaveBeenCalledWith(30_000)
    expect(fixture.close).toHaveBeenCalledTimes(3)
  })

  it('supports the caller request policy for network and websocket requests', async () => {
    const fixture = browserFixture()
    const policy = vi.fn<(url: string, kind: 'request' | 'websocket') => void>()
    await crawlWithBrowser({
      url: 'https://example.test',
      endpoint: 'ws://browser.example.test',
      connect: fixture.connect,
      requestPolicy: policy,
    })
    const route = routeFixture('data:text/plain,example', false)
    await fixture.routeHandler?.(route)
    const websocket = websocketFixture('wss://socket.example.test')
    await fixture.websocketHandler?.(websocket)
    expect(policy).toHaveBeenCalledWith('data:text/plain,example', 'request')
    expect(route.fallback).toHaveBeenCalledOnce()
    expect(policy).toHaveBeenCalledWith('wss://socket.example.test', 'websocket')
    expect(websocket.connectToServer).toHaveBeenCalledOnce()
  })

  it('prepares the page before installing the request policy', async () => {
    const fixture = browserFixture()
    const blockerRoute = vi.fn()
    const preparePage = vi.fn(async (page: Page) => {
      await page.route('**/*', blockerRoute)
    })
    await crawlWithBrowser({
      url: 'https://example.test',
      endpoint: 'ws://browser.example.test',
      connect: fixture.connect,
      preparePage,
      requestPolicy: () => undefined,
    })
    expect(preparePage).toHaveBeenCalledOnce()
    expect(fixture.route.mock.calls.map(([, handler]) => handler === blockerRoute)).toEqual([
      true,
      false,
    ])
  })

  it('reports a failing page preparation as a connect error', async () => {
    const fixture = browserFixture()
    const cause = new Error('filter list unavailable')
    const error = await crawlWithBrowser({
      url: 'https://example.test',
      endpoint: 'ws://browser.example.test',
      connect: fixture.connect,
      preparePage: () => {
        throw cause
      },
    }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(BrowserCrawlConnectError)
    expect((error as Error).cause).toBe(cause)
    expect(fixture.goto).not.toHaveBeenCalled()
    expect(fixture.close).toHaveBeenCalledTimes(3)
  })

  it('blocks policy-denied requests and propagates navigation-policy errors', async () => {
    const fixture = browserFixture()
    const denied = new Error('private address')
    fixture.goto.mockImplementation(async () => {
      await fixture.routeHandler?.(routeFixture('https://example.test', true))
      throw new Error('navigation aborted')
    })
    await expect(
      crawlWithBrowser({
        url: 'https://example.test',
        endpoint: 'ws://browser.example.test',
        connect: fixture.connect,
        requestPolicy: () => {
          throw denied
        },
      }),
    ).rejects.toBe(denied)
    const blocked = routeFixture('https://asset.example.test', false)
    await fixture.routeHandler?.(blocked)
    expect(blocked.abort).toHaveBeenCalledWith('blockedbyclient')
  })

  it('blocks policy-denied websocket requests', async () => {
    const fixture = browserFixture()
    await crawlWithBrowser({
      url: 'https://example.test',
      endpoint: 'ws://browser.example.test',
      connect: fixture.connect,
      requestPolicy: () => {
        throw new Error('blocked')
      },
    })
    const websocket = websocketFixture('wss://socket.example.test')
    await fixture.websocketHandler?.(websocket)
    expect(websocket.close).toHaveBeenCalledWith({ code: 1008, reason: 'blocked by client' })
  })

  it('classifies setup, timeout, and navigation failures', async () => {
    await expect(
      crawlWithBrowser({
        url: 'https://example.test',
        endpoint: 'ws://browser',
        connect: async () => {
          throw new Error('down')
        },
      }),
    ).rejects.toBeInstanceOf(BrowserCrawlConnectError)
    const timeout = browserFixture()
    const error = new Error('timed out')
    error.name = 'TimeoutError'
    timeout.goto.mockRejectedValue(error)
    await expect(crawlWithBrowser(request(timeout))).rejects.toBeInstanceOf(
      BrowserCrawlTimeoutError,
    )
    const navigation = browserFixture()
    navigation.goto.mockRejectedValue(new Error('network'))
    navigation.browser.close.mockRejectedValue(new Error('close'))
    await expect(
      crawlWithBrowser({
        ...request(navigation),
        onCleanupError: () => {
          throw new Error('reporter failed')
        },
      }),
    ).rejects.toBeInstanceOf(BrowserCrawlNavigationError)
  })

  it('passes measurement limits and omits absent html', async () => {
    const fixture = browserFixture()
    fixture.evaluate.mockResolvedValueOnce({ contentLength: 3, title: '' })
    const result = await crawlWithBrowser({
      ...request(fixture),
      minContentLength: 3,
      maxHtmlBytes: 2,
      maxTitleBytes: 4,
      maxTraversalWork: 5,
    })
    expect(result).toEqual({
      statusCode: 201,
      hasContent: true,
      title: '',
      contentLength: 3,
      finalUrl: 'https://example.test/final',
    })
    expect(fixture.evaluate).toHaveBeenCalledWith(measureAndSerializePage, {
      maxContentLength: 3,
      maxHtmlBytes: 2,
      maxTitleBytes: 4,
      maxTraversalWork: 5,
    })
  })

  it('reports cleanup errors without changing a result', async () => {
    const cleanup = browserFixture()
    cleanup.browser.close.mockRejectedValue(new Error('close'))
    const onCleanupError = vi.fn()
    await crawlWithBrowser({ ...request(cleanup), onCleanupError })
    expect(onCleanupError).toHaveBeenCalledTimes(3)
    const throwingReporter = browserFixture()
    throwingReporter.browser.close.mockRejectedValue(new Error('close'))
    await expect(
      crawlWithBrowser({
        ...request(throwingReporter),
        onCleanupError: () => {
          throw new Error('reporter failed')
        },
      }),
    ).resolves.toMatchObject({ statusCode: 201 })
  })

  it('validates caller options and allows an empty rendered page', async () => {
    const fixture = browserFixture()
    fixture.goto.mockResolvedValue(undefined)
    fixture.evaluate.mockResolvedValue({ contentLength: 0, title: ' ' })
    const empty = await crawlWithBrowser(request(fixture))
    expect(empty).toMatchObject({ hasContent: false, statusCode: 200, contentLength: 0 })
    for (const requestOverride of [
      { url: '' },
      { endpoint: '' },
      { maxHtmlBytes: 0 },
      { maxTitleBytes: 0 },
      { maxTraversalWork: 1.5 },
      { hydrationWaitMs: -1 },
    ]) {
      await expect(
        crawlWithBrowser({ ...request(browserFixture()), ...requestOverride }),
      ).rejects.toThrow(/required|safe integer/)
    }
  })
})

function request(fixture: ReturnType<typeof browserFixture>) {
  return {
    url: 'https://example.test',
    endpoint: 'ws://browser.example.test',
    connect: fixture.connect,
  }
}

function browserFixture() {
  const close = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
  const route = vi.fn()
  const routeWebSocket = vi.fn()
  const goto = vi.fn().mockResolvedValue({ status: () => 201 })
  const page = {
    close,
    evaluate: vi
      .fn()
      .mockImplementation(async (_measure, limits: { maxContentLength: number }) => ({
        contentLength: Math.min(100, limits.maxContentLength),
        html: '<main>Example</main>',
        title: 'Example',
      })),
    goto,
    route,
    routeWebSocket,
    setDefaultTimeout: vi.fn(),
    url: vi.fn().mockReturnValue('https://example.test/final'),
  }
  const context = { close, newPage: vi.fn().mockResolvedValue(page) }
  const newContext = vi.fn().mockResolvedValue(context)
  const browser = { close, newContext }
  const fixture = {
    browser,
    close,
    connect: vi.fn().mockResolvedValue(browser),
    evaluate: page.evaluate,
    goto,
    newContext,
    route,
    setDefaultTimeout: page.setDefaultTimeout,
    routeHandler: undefined as
      | ((route: ReturnType<typeof routeFixture>) => Promise<void>)
      | undefined,
    websocketHandler: undefined as
      | ((route: ReturnType<typeof websocketFixture>) => Promise<void>)
      | undefined,
  }
  route.mockImplementation((_pattern, handler) => {
    fixture.routeHandler = handler
  })
  routeWebSocket.mockImplementation((_pattern, handler) => {
    fixture.websocketHandler = handler
  })
  return fixture
}

function routeFixture(url: string, navigation: boolean) {
  return {
    abort: vi.fn().mockResolvedValue(undefined),
    fallback: vi.fn().mockResolvedValue(undefined),
    request: () => ({ isNavigationRequest: () => navigation, url: () => url }),
  }
}

function websocketFixture(url: string) {
  return {
    close: vi.fn().mockResolvedValue(undefined),
    connectToServer: vi.fn(),
    url: () => url,
  }
}
