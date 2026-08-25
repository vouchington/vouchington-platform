import { describe, expect, it, vi } from 'vitest'

import {
  BrowserCrawlConnectError,
  BrowserCrawlNavigationError,
  BrowserCrawlTimeoutError,
  crawlWithBrowser,
} from './index.mts'

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
      contentLength: 100,
      finalUrl: 'https://example.test/final',
      html: '<main>Example</main>',
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
    const route = routeFixture('https://asset.example.test', false)
    await fixture.routeHandler?.(route)
    const websocket = websocketFixture('wss://socket.example.test')
    await fixture.websocketHandler?.(websocket)
    expect(policy).toHaveBeenCalledWith('https://asset.example.test', 'request')
    expect(route.fallback).toHaveBeenCalledOnce()
    expect(policy).toHaveBeenCalledWith('wss://socket.example.test', 'websocket')
    expect(websocket.connectToServer).toHaveBeenCalledOnce()
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
    await expect(crawlWithBrowser(request(navigation))).rejects.toBeInstanceOf(
      BrowserCrawlNavigationError,
    )
  })

  it('handles absent or oversized html and cleanup errors without changing a result', async () => {
    const noHtml = browserFixture()
    noHtml.content.mockRejectedValue(new Error('unsupported'))
    const result = await crawlWithBrowser(request(noHtml))
    expect(result.html).toBeUndefined()
    const oversized = browserFixture()
    oversized.content.mockResolvedValue('x'.repeat(3))
    expect(
      (await crawlWithBrowser({ ...request(oversized), maxHtmlBytes: 2 })).html,
    ).toBeUndefined()
    const cleanup = browserFixture()
    cleanup.browser.close.mockRejectedValue(new Error('close'))
    const onCleanupError = vi.fn()
    await crawlWithBrowser({ ...request(cleanup), onCleanupError })
    expect(onCleanupError).toHaveBeenCalledTimes(3)
  })

  it('validates caller options and allows an empty rendered page', async () => {
    const fixture = browserFixture()
    fixture.goto.mockResolvedValue(undefined)
    fixture.title.mockResolvedValue('')
    fixture.evaluate.mockImplementation((callback) => callback())
    const empty = await crawlWithBrowser(request(fixture))
    expect(empty).toMatchObject({ hasContent: false, statusCode: 200, contentLength: 0 })
    for (const requestOverride of [
      { url: '' },
      { endpoint: '' },
      { maxHtmlBytes: 0 },
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
    content: vi.fn().mockResolvedValue('<main>Example</main>'),
    evaluate: vi.fn().mockImplementation((callback) => {
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: { body: { innerText: 'x'.repeat(100) } },
      })
      try {
        return callback()
      } finally {
        delete (globalThis as { document?: unknown }).document
      }
    }),
    goto,
    route,
    routeWebSocket,
    setDefaultTimeout: vi.fn(),
    title: vi.fn().mockResolvedValue('Example'),
    url: vi.fn().mockReturnValue('https://example.test/final'),
  }
  const context = { close, newPage: vi.fn().mockResolvedValue(page) }
  const newContext = vi.fn().mockResolvedValue(context)
  const browser = { close, newContext }
  const fixture = {
    browser,
    close,
    connect: vi.fn().mockResolvedValue(browser),
    content: page.content,
    evaluate: page.evaluate,
    goto,
    newContext,
    setDefaultTimeout: page.setDefaultTimeout,
    title: page.title,
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
