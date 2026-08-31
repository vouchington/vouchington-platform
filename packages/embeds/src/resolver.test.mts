import type { CrawlerHtmlToMarkdownResult } from '@vouchington/crawler-html'
import { describe, expect, it, vi } from 'vitest'

import { youtubeProvider } from './providers.mts'
import { createEmbedResolver, EmbedPolicyError } from './resolver.mts'
import type { EmbedAuthorizationContext, EmbedResolverOptions } from './types.mts'

const dispatcher = {} as NonNullable<RequestInit['dispatcher']>

describe('embed resolver', () => {
  it('resolves document and oEmbed metadata without returning raw HTML', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(htmlResponse('https://media.example/oembed'))
      .mockResolvedValueOnce(
        jsonResponse({
          type: 'video',
          title: 'oEmbed title',
          author_name: 'Creator',
          provider_name: 'Media',
          thumbnail_url: 'https://cdn.example/thumbnail.jpg',
          html: '<iframe src="https://player.example/embed/1"></iframe>',
          width: 640,
          height: 360,
        }),
      )
    const result = await createEmbedResolver(defaultOptions(fetch)).resolve(
      'https://media.example/watch/1',
    )
    expect(result).toEqual({
      kind: 'player',
      requestedUrl: 'https://media.example/watch/1',
      resolvedUrl: 'https://media.example/watch/1',
      title: 'oEmbed title',
      description: 'Document description',
      author: { name: 'Creator', url: null },
      provider: { key: null, name: 'Media', url: null, resourceId: null },
      thumbnail: { url: 'https://cdn.example/thumbnail.jpg', width: null, height: null },
      player: { url: 'https://player.example/embed/1', width: 640, height: 360 },
    })
    expect(JSON.stringify(result)).not.toContain('<iframe')
  })

  it('uses the final document URL after transport redirects', async () => {
    const response = htmlResponse()
    Object.defineProperty(response, 'url', { value: 'https://final.example/page' })
    const result = await createEmbedResolver(
      defaultOptions(vi.fn().mockResolvedValue(response)),
    ).resolve('https://start.example/page')
    expect(result.resolvedUrl).toBe('https://final.example/page')
  })

  it('cancels and rejects non-successful documents', async () => {
    const cancel = vi.fn(() => {
      throw new Error('cancel failed')
    })
    const response = new Response(new ReadableStream({ cancel }), { status: 500 })
    await expect(
      createEmbedResolver(defaultOptions(vi.fn().mockResolvedValue(response))).resolve(
        'https://example.com',
      ),
    ).rejects.toThrow('HTTP 500')
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('rejects non-HTML documents', async () => {
    const response = new Response('{}', { headers: { 'content-type': 'application/json' } })
    await expect(
      createEmbedResolver(defaultOptions(vi.fn().mockResolvedValue(response))).resolve(
        'https://example.com',
      ),
    ).rejects.toThrow('not HTML')
  })

  it('authorizes and resolves every redirect destination', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: 'https://next.example/page' } }),
      )
      .mockResolvedValueOnce(htmlResponse())
    const authorizeUrl = vi.fn().mockResolvedValue(true)
    const resolveDestination = vi.fn().mockReturnValue({ dispatcher })
    await createEmbedResolver({
      ...defaultOptions(fetch),
      authorizeUrl,
      resolveDestination,
    }).resolve('https://start.example/page')
    expect(authorizeUrl.mock.calls.map(([url, context]) => [url.href, context.purpose])).toEqual([
      ['https://start.example/page', 'document'],
      ['https://next.example/page', 'document'],
    ])
    expect(resolveDestination).toHaveBeenCalledTimes(2)
  })

  it('stops before resolving a redirect destination denied by policy', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: 'http://127.0.0.1/private' },
      }),
    )
    const authorizeUrl = vi.fn(
      async (url: URL, _context: EmbedAuthorizationContext) => url.hostname !== '127.0.0.1',
    )
    const resolveDestination = vi.fn().mockReturnValue({ dispatcher })
    await expect(
      createEmbedResolver({
        ...defaultOptions(fetch),
        authorizeUrl,
        resolveDestination,
      }).resolve('https://start.example/page'),
    ).rejects.toBeInstanceOf(EmbedPolicyError)
    expect(resolveDestination).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('applies oEmbed policy to every redirect and falls back when denied', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: 'http://127.0.0.1/oembed' },
      }),
    )
    const authorizeUrl = vi.fn(
      async (url: URL, _context: EmbedAuthorizationContext) => url.hostname !== '127.0.0.1',
    )
    const resolveDestination = vi.fn().mockReturnValue({ dispatcher })
    const result = await createEmbedResolver({
      ...defaultOptions(fetch),
      authorizeUrl,
      resolveDestination,
    }).resolveExtracted({
      documentUrl: 'https://example.com/post',
      content: extractedContent('https://api.example/oembed'),
    })
    expect(result.title).toBe('Document title')
    expect(authorizeUrl.mock.calls.map(([, context]) => context.purpose)).toEqual([
      'document',
      'oembed',
      'oembed',
    ])
    expect(resolveDestination).toHaveBeenCalledOnce()
  })

  it('rejects credential-bearing redirect destinations before caller policy', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: 'https://user:secret@next.example/page' },
      }),
    )
    const authorizeUrl = vi.fn().mockResolvedValue(true)
    await expect(
      createEmbedResolver({ ...defaultOptions(fetch), authorizeUrl }).resolve(
        'https://start.example/page',
      ),
    ).rejects.toBeInstanceOf(EmbedPolicyError)
    expect(authorizeUrl).toHaveBeenCalledOnce()
  })

  it('reuses extracted HTML without fetching the document', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(jsonResponse({ title: 'Remote title' }))
    const content: CrawlerHtmlToMarkdownResult = {
      content: 'body',
      meta: { description: 'Local description' },
      links: { alternate: { 'application/json+oembed': ['https://example.com/oembed'] } },
      title: 'Local title',
    }
    const result = await createEmbedResolver(defaultOptions(fetch)).resolveExtracted({
      documentUrl: 'https://example.com/post',
      content,
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(result.title).toBe('Remote title')
    expect(result.description).toBe('Local description')
  })

  it('falls back to document metadata when optional oEmbed fails', async () => {
    const onOEmbedError = vi.fn()
    const fetch = vi.fn().mockResolvedValue(
      new Response('bad', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    )
    const result = await createEmbedResolver({
      ...defaultOptions(fetch),
      onOEmbedError,
    }).resolveExtracted({
      documentUrl: 'https://example.com/post',
      content: extractedContent('https://example.com/oembed'),
    })
    expect(result.title).toBe('Document title')
    expect(result.kind).toBe('article')
    expect(onOEmbedError).toHaveBeenCalledOnce()
  })

  it('keeps oEmbed diagnostics best effort', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null))
    const result = await createEmbedResolver({
      ...defaultOptions(fetch),
      onOEmbedError() {
        throw new Error('telemetry failed')
      },
    }).resolveExtracted({
      documentUrl: 'https://example.com/post',
      content: extractedContent('https://example.com/oembed'),
    })
    expect(result.title).toBe('Document title')
  })

  it('does not swallow caller cancellation during optional oEmbed', async () => {
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await expect(
      createEmbedResolver(
        defaultOptions(vi.fn().mockRejectedValue(controller.signal.reason)),
      ).resolveExtracted(
        {
          documentUrl: 'https://example.com/post',
          content: extractedContent('https://example.com/oembed'),
        },
        { signal: controller.signal },
      ),
    ).rejects.toThrow('cancelled')
  })

  it('cancels unsuccessful oEmbed responses and keeps document metadata', async () => {
    const cancel = vi.fn(() => {
      throw new Error('cancel failed')
    })
    const response = new Response(new ReadableStream({ cancel }), { status: 503 })
    const result = await createEmbedResolver(
      defaultOptions(vi.fn().mockResolvedValue(response)),
    ).resolveExtracted({
      documentUrl: 'https://example.com/post',
      content: extractedContent('https://example.com/oembed'),
    })
    expect(result.title).toBe('Document title')
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('normalizes optional author, provider, and thumbnail metadata', async () => {
    const response = jsonResponse({
      type: 'link',
      author_url: '/author',
      provider_url: '/provider',
      thumbnail_url: '/thumbnail',
      thumbnail_width: 120,
      thumbnail_height: 80,
    })
    Object.defineProperty(response, 'url', { value: 'https://api.example/oembed' })
    const result = await createEmbedResolver(
      defaultOptions(vi.fn().mockResolvedValue(response)),
    ).resolveExtracted({
      documentUrl: 'https://example.com/post',
      content: extractedContent('https://api.example/oembed'),
    })
    expect(result.author).toEqual({ name: null, url: 'https://api.example/author' })
    expect(result.provider).toEqual({
      key: null,
      name: null,
      url: 'https://api.example/provider',
      resourceId: null,
    })
    expect(result.thumbnail).toEqual({
      url: 'https://api.example/thumbnail',
      width: 120,
      height: 80,
    })
  })

  it('does not use iframe HTML from non-player oEmbed types', async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        type: 'photo',
        html: '<iframe src="https://player.example/embed"></iframe>',
      }),
    )
    const result = await createEmbedResolver(defaultOptions(fetch)).resolveExtracted({
      documentUrl: 'https://example.com/post',
      content: extractedContent('https://example.com/oembed'),
    })
    expect(result.kind).toBe('article')
    expect(result.player).toBeNull()
  })

  it('does not emit a player denied by caller policy', async () => {
    const options = defaultOptions(vi.fn())
    options.providers = [youtubeProvider]
    options.authorizeUrl = vi.fn(async (_url, context) => context.purpose !== 'player')
    const result = await createEmbedResolver(options).resolveExtracted({
      documentUrl: 'https://youtube.com/watch?v=abc',
      content: extractedContent(),
    })
    expect(result.kind).toBe('article')
    expect(result.player).toBeNull()
    expect(result.provider?.resourceId).toBe('abc')
  })

  it('emits an authorized preset player without oEmbed metadata', async () => {
    const options = defaultOptions(vi.fn().mockRejectedValue(new Error('offline')))
    options.providers = [youtubeProvider]
    const result = await createEmbedResolver(options).resolveExtracted({
      documentUrl: 'https://youtube.com/watch?v=abc',
      content: {
        content: '',
        meta: { 'og:image': '/document-thumbnail' },
        links: {},
      },
    })
    expect(result.kind).toBe('player')
    expect(result.player).toEqual({
      url: 'https://www.youtube-nocookie.com/embed/abc',
      width: null,
      height: null,
    })
    expect(result.thumbnail).toEqual({
      url: 'https://youtube.com/document-thumbnail',
      width: null,
      height: null,
    })
  })

  it('rejects a denied document before destination resolution', async () => {
    const options = defaultOptions(vi.fn())
    options.authorizeUrl = vi.fn().mockResolvedValue(false)
    await expect(
      createEmbedResolver(options).resolve('https://denied.example'),
    ).rejects.toBeInstanceOf(EmbedPolicyError)
    expect(options.resolveDestination).not.toHaveBeenCalled()
  })

  it('rejects credential-bearing document URLs', async () => {
    await expect(
      createEmbedResolver(defaultOptions(vi.fn())).resolve('https://user:secret@example.com'),
    ).rejects.toThrow('without credentials')
  })

  it('allows callers to disable redirects', () => {
    expect(() => createEmbedResolver({ ...defaultOptions(vi.fn()), maxRedirects: 0 })).not.toThrow()
  })

  it('enforces the document body limit while streaming', async () => {
    const options = defaultOptions(vi.fn().mockResolvedValue(htmlResponse(undefined, '123456')))
    options.maxDocumentSizeBytes = 5
    await expect(createEmbedResolver(options).resolve('https://example.com')).rejects.toThrow(
      'exceeds 5 bytes',
    )
  })
})

function defaultOptions(fetch: EmbedResolverOptions['fetch']): EmbedResolverOptions {
  return {
    fetch,
    resolveDestination: vi.fn().mockReturnValue({ dispatcher }),
    authorizeUrl: vi.fn().mockResolvedValue(true),
    userAgent: 'embeds-test/1.0',
  }
}

function extractedContent(oEmbedUrl?: string): CrawlerHtmlToMarkdownResult {
  return {
    content: 'body',
    meta: { description: 'Document description' },
    links: oEmbedUrl ? { alternate: { 'application/json+oembed': [oEmbedUrl] } } : {},
    title: 'Document title',
  }
}

function htmlResponse(oEmbedUrl?: string, body = 'body'): Response {
  const link = oEmbedUrl
    ? `<link rel="alternate" type="application/json+oembed" href="${oEmbedUrl}">`
    : ''
  return new Response(
    `<html><head><title>Document title</title><meta name="description" content="Document description">${link}</head><body>${body}</body></html>`,
    { status: 200, headers: { 'content-type': 'text/html' } },
  )
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
