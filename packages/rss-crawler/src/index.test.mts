import { describe, expect, it, vi } from 'vitest'
import {
  crawlFeed,
  type FeedResponseErrorContext,
  type FeedResponseErrorHandler,
  type FeedTransport,
} from './index.mts'

type IsAssignable<From, To> = [From] extends [To] ? true : false

const _asyncResponseErrorHandlerIsNotAssignable: IsAssignable<
  (context: FeedResponseErrorContext) => Promise<Error | undefined>,
  FeedResponseErrorHandler
> = false

function transport(response: Response): FeedTransport {
  return { fetch: async () => response }
}

describe('crawlFeed', () => {
  it('passes effective response arguments to a caller-owned body reader', async () => {
    const response = new Response('<rss version="2.0"><channel><title>x</title></channel></rss>', {
      headers: { 'content-type': 'application/rss+xml' },
    })
    let context: unknown
    await crawlFeed('https://example.test/feed', {
      transport: transport(response),
      userAgent: 'a',
      maxResponseSizeBytes: 123,
      responseBodyReader: async (bodyReaderContext) => {
        context = bodyReaderContext
        return Buffer.from('<rss version="2.0"><channel><title>x</title></channel></rss>')
      },
    })
    expect(context).toEqual({
      response,
      url: 'https://example.test/feed',
      maxResponseSizeBytes: 123,
      signal: expect.any(AbortSignal),
    })
  })

  it('accepts Buffer and Uint8Array bodies from a caller-owned reader', async () => {
    const body = '<rss version="2.0"><channel><title>x</title></channel></rss>'
    for (const bytes of [Buffer.from(body), new TextEncoder().encode(body)]) {
      await expect(
        crawlFeed('https://example.test/feed', {
          transport: transport(
            new Response(null, { headers: { 'content-type': 'application/rss+xml' } }),
          ),
          userAgent: 'a',
          responseBodyReader: async () => bytes,
        }),
      ).resolves.toMatchObject({ feed: { title: 'x' } })
    }
  })

  it('preserves caller body-reader errors while readers clean up their own locks', async () => {
    const failure = new Error('caller reader failure')
    const response = responseWithBody(['x'], 200, undefined, true)
    await expect(
      crawlFeed('https://example.test', {
        transport: transport(response.response),
        userAgent: 'a',
        responseBodyReader: async ({ response: bodyResponse }) => {
          const reader = bodyResponse.body?.getReader()
          if (!reader) throw new Error('expected body reader')
          try {
            await reader.read()
            throw failure
          } finally {
            try {
              await reader.cancel()
            } catch {
              // Reader cleanup must not replace the caller error.
            }
            reader.releaseLock()
          }
        },
      }),
    ).rejects.toBe(failure)
    expect(response.wasCanceled()).toBe(true)
  })

  it('maps HTTP, content-type, and redirect errors before their defaults', async () => {
    const cases = [
      { response: responseWithBody(['x'], 500), type: 'http', expected: { status: 500 } },
      {
        response: responseWithBody(['x'], 200, { 'content-type': 'text/html' }),
        type: 'content-type',
        expected: { contentType: 'text/html' },
      },
      { response: responseWithBody(['x'], 301), type: 'redirect', expected: { location: null } },
    ] as const
    for (const { response, type, expected } of cases) {
      const failure = new Error(`${type} failure`)
      await expect(
        crawlFeed('https://example.test/feed', {
          transport: transport(response.response),
          userAgent: 'a',
          responseErrorHandler: (context) => {
            expect(context).toMatchObject({ type, url: 'https://example.test/feed', ...expected })
            return failure
          },
        }),
      ).rejects.toBe(failure)
      expect(response.wasCanceled()).toBe(true)
    }
  })

  it('keeps raw relative redirects caller-selectable', async () => {
    const resolver = ({ location, baseUrl }: { location: string; baseUrl: string }) =>
      `${baseUrl}|${location}`
    await expect(
      crawlFeed('https://example.test/feed', {
        transport: transport(new Response(null, { status: 302, headers: { location: '../next' } })),
        userAgent: 'a',
        redirectResolver: resolver,
      }),
    ).resolves.toMatchObject({ redirect: { location: 'https://example.test/feed|../next' } })
    await expect(
      crawlFeed('https://example.test/feed', {
        transport: transport(new Response(null, { status: 302, headers: { location: '../next' } })),
        userAgent: 'a',
      }),
    ).resolves.toMatchObject({ redirect: { location: 'https://example.test/next' } })
  })

  it('aborts a caller-owned body reader at its timeout', async () => {
    vi.useFakeTimers()
    try {
      const pending = crawlFeed('https://example.test', {
        transport: transport(
          new Response(null, { headers: { 'content-type': 'application/rss+xml' } }),
        ),
        userAgent: 'a',
        timeoutMs: 1,
        responseBodyReader: async ({ signal }) =>
          await new Promise<Uint8Array>((_resolve, reject) =>
            signal.addEventListener('abort', () => reject(new Error('reader aborted'))),
          ),
      })
      const assertion = expect(pending).rejects.toThrow('reader aborted')
      await vi.advanceTimersByTimeAsync(1)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })

  it('passes caller headers and parses a successful RSS response', async () => {
    let headers: Record<string, string> | undefined
    const result = await crawlFeed('https://example.test/feed', {
      transport: {
        fetch: async (_url, request) => {
          headers = request.headers
          return new Response('<rss version="2.0"><channel><title>x</title></channel></rss>', {
            headers: { 'content-type': 'application/rss+xml', etag: 'tag' },
          })
        },
      },
      userAgent: 'test-bot',
      headers: { Authorization: 'Bearer x', accept: 'text/html', 'USER-AGENT': 'other' },
    })
    expect(headers).toMatchObject({ 'user-agent': 'test-bot', authorization: 'Bearer x' })
    expect(headers?.accept).not.toContain('text/html')
    expect(result.feed?.title).toBe('x')
    expect(result.headers.etag).toBe('tag')
  })

  it('returns conditional and redirect results', async () => {
    await expect(
      crawlFeed('https://example.test', {
        transport: transport(new Response(null, { status: 304 })),
        userAgent: 'a',
      }),
    ).resolves.toMatchObject({ responseCode: 304, feed: null })
    await expect(
      crawlFeed('https://example.test', {
        transport: transport(new Response(null, { status: 301, headers: { location: '/next' } })),
        userAgent: 'a',
      }),
    ).resolves.toMatchObject({
      redirect: { location: 'https://example.test/next', isPermanent: true },
    })
    await expect(
      crawlFeed('https://example.test', {
        transport: transport(new Response(null, { status: 307, headers: { location: '/next' } })),
        userAgent: 'a',
      }),
    ).resolves.toMatchObject({ redirect: { isPermanent: false } })
    await expect(
      crawlFeed('https://example.test', {
        transport: transport(new Response(null, { status: 302 })),
        userAgent: 'a',
      }),
    ).rejects.toThrow('Location')
  })

  it('rejects invalid responses and limits', async () => {
    await expect(
      crawlFeed('https://example.test', {
        transport: transport(new Response('x', { status: 500 })),
        userAgent: 'a',
      }),
    ).rejects.toThrow('500')
    await expect(
      crawlFeed('https://example.test', {
        transport: transport(new Response('x', { headers: { 'content-type': 'text/html' } })),
        userAgent: 'a',
      }),
    ).rejects.toThrow('feed content')
    await expect(
      crawlFeed('https://example.test', {
        transport: transport(
          new Response('abcd', { headers: { 'content-type': 'application/rss+xml' } }),
        ),
        userAgent: 'a',
        maxResponseSizeBytes: 1,
      }),
    ).rejects.toThrow('exceeds')
    await expect(
      crawlFeed('https://example.test', {
        transport: transport(new Response('')),
        userAgent: 'a',
        timeoutMs: 0,
      }),
    ).rejects.toThrow('timeoutMs')
  })

  it('bounds streams and cancels bodies that are not consumed', async () => {
    const overflow = responseWithBody(['ab', 'cd'])
    await expect(
      crawlFeed('https://example.test', {
        transport: transport(overflow.response),
        userAgent: 'a',
        maxResponseSizeBytes: 3,
      }),
    ).rejects.toThrow('exceeds')
    expect(overflow.wasCanceled()).toBe(true)
    const failedCancellation = responseWithBody(['ab', 'cd'], 200, undefined, true)
    await expect(
      crawlFeed('https://example.test', {
        transport: transport(failedCancellation.response),
        userAgent: 'a',
        maxResponseSizeBytes: 3,
      }),
    ).rejects.toThrow('exceeds')

    const unavailable = responseWithBody(['x'], 500)
    await expect(
      crawlFeed('https://example.test', {
        transport: transport(unavailable.response),
        userAgent: 'a',
      }),
    ).rejects.toThrow('500')
    expect(unavailable.wasCanceled()).toBe(true)

    const invalid = responseWithBody(['x'], 200, { 'content-type': 'text/html' })
    await expect(
      crawlFeed('https://example.test', { transport: transport(invalid.response), userAgent: 'a' }),
    ).rejects.toThrow('feed content')
    expect(invalid.wasCanceled()).toBe(true)

    await expect(
      crawlFeed('https://example.test', {
        transport: transport({
          status: 304,
          headers: new Headers(),
          body: {
            cancel: async () => {
              throw new Error('ignored')
            },
          },
        } as unknown as Response),
        userAgent: 'a',
      }),
    ).resolves.toMatchObject({ responseCode: 304 })
  })

  it('handles a successful response without a body', async () => {
    await expect(
      crawlFeed('https://example.test', {
        transport: transport({
          status: 200,
          ok: true,
          headers: new Headers({ 'content-type': 'application/rss+xml' }),
          body: null,
        } as unknown as Response),
        userAgent: 'a',
      }),
    ).rejects.toThrow('Unrecognized feed format')
  })

  it('aborts a transport that exceeds its timeout', async () => {
    vi.useFakeTimers()
    try {
      const pending = crawlFeed('https://example.test', {
        transport: {
          fetch: async (_url, request) =>
            await new Promise<Response>((_resolve, reject) =>
              request.signal.addEventListener('abort', () => reject(new Error('aborted'))),
            ),
        },
        userAgent: 'a',
        timeoutMs: 1,
      })
      const assertion = expect(pending).rejects.toThrow('aborted')
      await vi.advanceTimersByTimeAsync(1)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })
})

function responseWithBody(
  chunks: string[],
  status = 200,
  headers: Record<string, string> | undefined = { 'content-type': 'application/rss+xml' },
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
  return { response: new Response(stream, { status, headers }), wasCanceled: () => canceled }
}
