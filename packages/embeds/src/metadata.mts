import type { CrawlerHtmlToMarkdownResult } from '@vouchington/crawler-html'

export interface DocumentMetadata {
  title: string | null
  description: string | null
  thumbnailUrl: URL | null
  oEmbedUrl: URL | null
}

export function extractDocumentMetadata(
  content: CrawlerHtmlToMarkdownResult,
  documentUrl: URL,
): DocumentMetadata {
  return {
    title: firstString(content.meta, ['og:title', 'twitter:title']) ?? clean(content.title),
    description: firstString(content.meta, [
      'og:description',
      'twitter:description',
      'description',
    ]),
    thumbnailUrl: resolveHttpUrl(
      firstString(content.meta, ['og:image:secure_url', 'og:image', 'twitter:image']),
      documentUrl,
    ),
    oEmbedUrl: resolveHttpUrl(oEmbedHref(content.links), documentUrl),
  }
}

export function resolveHttpUrl(value: string | null, base: URL): URL | null {
  if (!value) return null
  try {
    const url = new URL(value, base)
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
      ? url
      : null
  } catch {
    return null
  }
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && clean(value)) return clean(value)
    if (Array.isArray(value)) {
      const first = value.find((item): item is string => typeof item === 'string' && !!clean(item))
      if (first) return clean(first)
    }
  }
  return null
}

function oEmbedHref(links: Record<string, unknown>): string | null {
  const alternate = links.alternate
  if (!alternate || typeof alternate !== 'object' || Array.isArray(alternate)) return null
  return firstString(alternate as Record<string, unknown>, [
    'application/json+oembed',
    'application/json; charset=utf-8+oembed',
  ])
}

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}
