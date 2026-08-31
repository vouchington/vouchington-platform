import type { CrawlerHtmlToMarkdownResult } from '@vouchington/crawler-html'
import { describe, expect, it, vi } from 'vitest'

import { youtubeProvider } from './providers.mts'
import { createEmbedResolver, OEmbedHttpError } from './resolver.mts'
import type { EmbedResolverOptions } from './types.mts'

const dispatcher = {} as NonNullable<RequestInit['dispatcher']>

describe('split embed resolution', () => {
  it('plans extracted metadata without performing the optional request', async () => {
    const fetch = vi.fn()
    const resolver = createEmbedResolver(defaultOptions(fetch))
    const plan = await resolver.planExtracted(input())
    expect(fetch).not.toHaveBeenCalled()
    expect(plan.embed.title).toBe('Document title')
    expect(plan.oEmbedUrl).toBe('https://api.example/oembed')
    expect(JSON.parse(JSON.stringify(plan))).toEqual(plan)
    expect(await resolver.resolveOEmbed({ ...plan, oEmbedUrl: null })).toEqual(plan.embed)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('resolves a planned request as a separate throwing phase', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ title: 'Remote title' }))
    const resolver = createEmbedResolver(defaultOptions(fetch))
    const plan = await resolver.planExtracted(input())
    expect((await resolver.resolveOEmbed(plan)).title).toBe('Remote title')
    fetch.mockResolvedValue(new Response(null, { status: 503 }))
    await expect(resolver.resolveOEmbed(plan)).rejects.toThrow('HTTP 503')
  })

  it('exposes status and retry timing to application-owned queues', async () => {
    const resolver = createEmbedResolver(
      defaultOptions(
        vi
          .fn()
          .mockResolvedValue(new Response(null, { status: 429, headers: { 'retry-after': '15' } })),
      ),
    )
    const plan = await resolver.planExtracted(input())
    const error = await resolver.resolveOEmbed(plan).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(OEmbedHttpError)
    expect(error).toMatchObject({ status: 429, retryAfter: '15' })
  })

  it('enriches preset players while preserving local fallbacks', async () => {
    const options = defaultOptions(
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ type: 'video', title: 'Remote title', width: 640, height: 360 }),
        ),
    )
    options.providers = [youtubeProvider]
    const resolver = createEmbedResolver(options)
    const plan = await resolver.planExtracted({
      documentUrl: 'https://youtube.com/watch?v=abc',
      content: {
        content: '',
        meta: { 'og:image': '/document-thumbnail' },
        links: {},
      },
    })
    const result = await resolver.resolveOEmbed(plan)
    expect(result.player).toEqual({
      url: 'https://www.youtube-nocookie.com/embed/abc',
      width: 640,
      height: 360,
    })
    expect(result.thumbnail?.url).toBe('https://youtube.com/document-thumbnail')
  })

  it('preserves planned player dimensions without remote video metadata', async () => {
    const options = defaultOptions(vi.fn().mockResolvedValue(jsonResponse({ type: 'link' })))
    options.providers = [youtubeProvider]
    const resolver = createEmbedResolver(options)
    const plan = await resolver.planExtracted({
      documentUrl: 'https://youtube.com/watch?v=abc',
      content: extractedContent(),
    })
    plan.embed.player = { ...plan.embed.player!, width: 320, height: 180 }
    expect((await resolver.resolveOEmbed(plan)).player).toMatchObject({ width: 320, height: 180 })
  })

  it('drops a remote player denied by application policy', async () => {
    const options = defaultOptions(vi.fn().mockResolvedValue(playerResponse()))
    options.authorizeUrl = vi.fn(async (_url, context) => context.purpose !== 'player')
    const resolver = createEmbedResolver(options)
    const plan = await resolver.planExtracted(input())
    expect((await resolver.resolveOEmbed(plan)).player).toBeNull()
  })

  it('keeps missing remote player dimensions null', async () => {
    const resolver = createEmbedResolver(
      defaultOptions(vi.fn().mockResolvedValue(playerResponse())),
    )
    const plan = await resolver.planExtracted(input())
    expect((await resolver.resolveOEmbed(plan)).player).toMatchObject({
      width: null,
      height: null,
    })
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

function input() {
  return {
    documentUrl: 'https://example.com/post',
    content: extractedContent('https://api.example/oembed'),
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

function playerResponse(): Response {
  return jsonResponse({
    type: 'video',
    html: '<iframe src="https://player.example/embed"></iframe>',
  })
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
