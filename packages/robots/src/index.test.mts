import { describe, expect, it } from 'vitest'
import {
  getCrawlDelayMilliseconds,
  getCrawlDelayMs,
  isUrlAllowed,
  type RobotsCache,
  type RobotsTransport,
} from './index.mts'

function transport(body: string, status = 200): RobotsTransport {
  return { fetch: async () => new Response(body, { status }) }
}

describe('robots', () => {
  it('applies allow/disallow and crawl delay rules', async () => {
    const options = {
      transport: transport('User-agent: bot\nDisallow: /private\nCrawl-delay: 1.5'),
    }
    await expect(isUrlAllowed('https://example.test/public', 'bot', options)).resolves.toBe(true)
    await expect(isUrlAllowed('https://example.test/private', 'bot', options)).resolves.toBe(false)
    await expect(getCrawlDelayMs('https://example.test/', 'bot', options)).resolves.toBe(1500)
    await expect(getCrawlDelayMs('https://example.test/', 'other', options)).resolves.toBeNull()
    await expect(isUrlAllowed('https://example.test/', 'other', options)).resolves.toBe(true)
  })

  it('uses caller cache and applies status or size fallbacks', async () => {
    const calls: string[] = []
    const cache: RobotsCache = {
      get: async (key) => {
        calls.push(`get:${key}`)
        return 'User-agent: *\nDisallow: /'
      },
      set: async () => {
        throw new Error('not used')
      },
    }
    await expect(
      isUrlAllowed('https://example.test/', 'bot', { transport: transport(''), cache }),
    ).resolves.toBe(false)
    expect(calls).toHaveLength(1)
    await expect(
      isUrlAllowed('https://example.test/', 'bot', { transport: transport('', 404) }),
    ).resolves.toBe(true)
    await expect(
      isUrlAllowed('https://example.test/', 'bot', { transport: transport('', 401) }),
    ).resolves.toBe(true)
    await expect(
      isUrlAllowed('https://example.test/', 'bot', { transport: transport('', 503) }),
    ).resolves.toBe(false)
    const statusWrites: unknown[] = []
    await expect(
      isUrlAllowed('https://example.test/', 'bot', {
        transport: transport('', 429),
        cache: {
          get: async () => undefined,
          set: async (...args) => {
            statusWrites.push(args)
          },
        },
        statusFallback: async (status) => ({
          rules: status === 429 ? 'User-agent: *\nDisallow: /' : '',
          cache: false,
        }),
      }),
    ).resolves.toBe(false)
    expect(statusWrites).toEqual([])
    const overflowWrites: unknown[] = []
    await expect(
      isUrlAllowed('https://example.test/', 'bot', {
        transport: transport('abcdef'),
        maxResponseSizeBytes: 1,
        cache: {
          get: async () => undefined,
          set: async (...args) => {
            overflowWrites.push(args)
          },
        },
      }),
    ).resolves.toBe(true)
    expect(overflowWrites).toEqual([])
  })

  it('writes cache and rejects invalid limits', async () => {
    const writes: unknown[] = []
    const cache: RobotsCache = {
      get: async () => undefined,
      set: async (...args) => {
        writes.push(args)
      },
    }
    await isUrlAllowed('https://example.test/', 'bot', {
      transport: transport('User-agent: *\nAllow: /'),
      cache,
      ttlMs: 1,
    })
    expect(writes).toHaveLength(1)
    await isUrlAllowed('https://example.test/', 'bot', {
      transport: transport('User-agent: *\nAllow: /'),
      cache,
    })
    expect(writes).toHaveLength(2)
    await expect(
      isUrlAllowed('https://example.test/', 'bot', {
        transport: transport(''),
        maxResponseSizeBytes: 0,
      }),
    ).rejects.toThrow('maxResponse')
    await expect(
      isUrlAllowed('https://example.test/', 'bot', {
        transport: transport(''),
        maxResponseSizeBytes: 0.5,
      }),
    ).rejects.toThrow('maxResponse')
  })

  it('bounds streams, cancels unavailable responses, and coalesces matching options', async () => {
    const overflow = responseWithBody(['ab', 'cd'])
    await expect(
      isUrlAllowed('https://example.test/', 'bot', {
        transport: transportResponse(overflow.response),
        maxResponseSizeBytes: 3,
      }),
    ).resolves.toBe(true)
    expect(overflow.wasCanceled()).toBe(true)
    const failedCancellation = responseWithBody(['ab', 'cd'], 200, true)
    await expect(
      isUrlAllowed('https://example.test/', 'bot', {
        transport: transportResponse(failedCancellation.response),
        maxResponseSizeBytes: 3,
      }),
    ).resolves.toBe(true)
    const unavailable = responseWithBody(['x'], 503)
    await expect(
      isUrlAllowed('https://example.test/', 'bot', {
        transport: transportResponse(unavailable.response),
      }),
    ).resolves.toBe(false)
    expect(unavailable.wasCanceled()).toBe(true)

    let calls = 0
    let releaseFetch: () => void = () => undefined
    const waitForFetch = new Promise<void>((resolve) => {
      releaseFetch = resolve
    })
    const options = {
      transport: {
        fetch: async () => {
          calls += 1
          await waitForFetch
          return new Response('User-agent: *\nAllow: /')
        },
      },
    }
    const first = isUrlAllowed('https://example.test/one', 'bot', options)
    const second = isUrlAllowed('https://example.test/two', 'bot', options)
    releaseFetch()
    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    expect(calls).toBe(1)
  })

  it('normalizes unusable crawl delays and accepts empty bodies', async () => {
    expect(getCrawlDelayMilliseconds(undefined)).toBeNull()
    expect(getCrawlDelayMilliseconds(Number.NaN)).toBeNull()
    expect(getCrawlDelayMilliseconds(Number.POSITIVE_INFINITY)).toBeNull()
    expect(getCrawlDelayMilliseconds(-1)).toBeNull()
    expect(getCrawlDelayMilliseconds(1.2)).toBe(1200)
    await expect(
      isUrlAllowed('https://example.test/', 'bot', {
        transport: { fetch: async () => new Response(null) },
      }),
    ).resolves.toBe(true)
  })
})

function transportResponse(response: Response): RobotsTransport {
  return { fetch: async () => response }
}

function responseWithBody(
  chunks: string[],
  status = 200,
  cancelFails = false,
): { response: Response; wasCanceled: () => boolean } {
  let canceled = false
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks.shift()
      if (chunk) controller.enqueue(Buffer.from(chunk))
    },
    cancel() {
      canceled = true
      if (cancelFails) throw new Error('cancel failed')
    },
  })
  return { response: new Response(stream, { status }), wasCanceled: () => canceled }
}
