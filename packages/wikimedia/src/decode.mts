import { WikimediaDecodeError } from './errors.mts'
import type { WikimediaPageSummary, WikimediaSearchResult } from './types.mts'

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function nullableString(value: unknown): string | null {
  if (value === undefined || value === null) return null
  return typeof value === 'string' ? value : null
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function pageId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

export function decodeSearch(value: unknown, url: string): readonly WikimediaSearchResult[] {
  const body = object(value)
  if (body === null || !Array.isArray(body.pages)) throw new WikimediaDecodeError(url)
  return body.pages.map((page) => {
    const result = object(page)
    if (result === null || !pageId(result.id) || !nonEmptyString(result.title)) {
      throw new WikimediaDecodeError(url)
    }
    return { pageId: result.id, title: result.title }
  })
}

export function decodeSummary(
  value: unknown,
  url: string,
  pageOrigin: string,
): WikimediaPageSummary {
  const body = object(value)
  if (body === null || !pageId(body.pageid) || !nonEmptyString(body.title)) {
    throw new WikimediaDecodeError(url)
  }
  const contentUrls = body.content_urls === undefined ? undefined : object(body.content_urls)
  const desktop = contentUrls?.desktop === undefined ? undefined : object(contentUrls.desktop)
  const thumbnail = body.thumbnail === undefined ? undefined : object(body.thumbnail)
  if (
    (body.content_urls !== undefined && contentUrls === null) ||
    (contentUrls?.desktop !== undefined && desktop === null) ||
    (body.thumbnail !== undefined && thumbnail === null)
  ) {
    throw new WikimediaDecodeError(url)
  }
  const pageUrl = desktop?.page
  const thumbnailUrl = thumbnail?.source
  if (
    (desktop !== undefined && !nonEmptyString(pageUrl)) ||
    (thumbnail !== undefined && !nonEmptyString(thumbnailUrl))
  ) {
    throw new WikimediaDecodeError(url)
  }
  const resolvedPageUrl = nonEmptyString(pageUrl) ? pageUrl : undefined
  const resolvedThumbnailUrl = nonEmptyString(thumbnailUrl) ? thumbnailUrl : null
  const extract = nullableString(body.extract)
  const description = nullableString(body.description)
  if (
    (body.extract !== undefined && extract === null && body.extract !== null) ||
    (body.description !== undefined && description === null && body.description !== null)
  ) {
    throw new WikimediaDecodeError(url)
  }
  return {
    pageId: body.pageid,
    title: body.title,
    url: resolvedPageUrl ?? `${pageOrigin}/wiki/${encodeURIComponent(body.title)}`,
    extract,
    description,
    thumbnailUrl: resolvedThumbnailUrl,
  }
}
