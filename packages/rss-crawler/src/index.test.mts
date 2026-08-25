import { describe, expect, it, vi } from 'vitest'
import { crawlFeed, type FeedTransport } from './index.mts'

function transport(response: Response): FeedTransport {
  return { fetch: async () => response }
}

describe('crawlFeed', () => {
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
      headers: { Authorization: 'Bearer x' },
    })
    expect(headers).toMatchObject({ 'User-Agent': 'test-bot', Authorization: 'Bearer x' })
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
    ).resolves.toMatchObject({ redirect: { location: '/next', isPermanent: true } })
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
