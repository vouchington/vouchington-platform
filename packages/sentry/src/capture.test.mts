import { describe, expect, it, vi } from 'vitest'
import { captureError } from './capture.mts'
import { captureAndFlush, initNodeSentry } from './node.mts'
import { initBrowserSentry } from './browser.mts'

const input = {
  dsn: 'https://key@sentry.test/1',
  environment: 'staging',
  enabledEnvironments: ['staging'],
  scrub: { credentialHeaders: [] },
}

describe('captureError', () => {
  it('captures Error instances with tags and extra', () => {
    const client = { captureException: vi.fn() }
    const error = new Error('x')
    expect(
      captureError(client, error, { fallbackMessage: 'f', tags: { a: 'b' }, extra: { c: 1 } }),
    ).toBe(true)
    expect(client.captureException).toHaveBeenCalledWith(error, {
      tags: { a: 'b' },
      extra: { c: 1 },
    })
  })

  it('omits empty hints', () => {
    const client = { captureException: vi.fn() }
    const error = new Error('x')
    captureError(client, error, { fallbackMessage: 'f' })
    expect(client.captureException).toHaveBeenCalledWith(error, {})
  })

  it('wraps non-Error values and keeps the original value', () => {
    const client = { captureException: vi.fn() }
    captureError(client, 'oops', { fallbackMessage: 'fallback', extra: { k: 1 } })
    const [captured, hint] = client.captureException.mock.calls[0] as [Error, unknown]
    expect(captured.message).toBe('fallback')
    expect(hint).toEqual({ extra: { k: 1, originalValue: 'oops' } })
  })

  it('skips expected errors', () => {
    const client = { captureException: vi.fn() }
    expect(captureError(client, 'x', { fallbackMessage: 'f', isExpected: () => true })).toBe(false)
    expect(client.captureException).not.toHaveBeenCalled()
  })
})

describe('node helpers', () => {
  it('initializes the app-owned SDK with the composed options', () => {
    const client = { init: vi.fn() }
    const options = initNodeSentry(client, input)
    expect(client.init).toHaveBeenCalledWith(options)
    expect(options.enabled).toBe(true)
  })

  it('captures then flushes with a default or custom timeout', async () => {
    const client = { captureException: vi.fn(), flush: vi.fn().mockResolvedValue(true) }
    await expect(captureAndFlush(client, new Error('x'), { fallbackMessage: 'f' })).resolves.toBe(
      true,
    )
    expect(client.flush).toHaveBeenLastCalledWith(2000)
    await captureAndFlush(client, new Error('x'), { fallbackMessage: 'f', flushTimeoutMs: 50 })
    expect(client.flush).toHaveBeenLastCalledWith(50)
  })

  it('does not flush for expected errors', async () => {
    const client = { captureException: vi.fn(), flush: vi.fn() }
    const result = await captureAndFlush(client, 'x', {
      fallbackMessage: 'f',
      isExpected: () => true,
    })
    expect(result).toBe(false)
    expect(client.flush).not.toHaveBeenCalled()
  })
})

describe('browser helpers', () => {
  it('initializes the browser SDK through the injected tunnel', () => {
    const client = { init: vi.fn() }
    const options = initBrowserSentry(client, { ...input, tunnel: '/monitoring' })
    expect(client.init).toHaveBeenCalledWith(options)
    expect(options.tunnel).toBe('/monitoring')
  })
})
