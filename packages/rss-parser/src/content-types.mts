import { MIMEType } from 'node:util'

export const RSS_CONTENT_TYPES = [
  'application/rss+xml',
  'application/atom+xml',
  'application/xml',
  'text/xml',
  'application/feed+json',
  'application/json',
]

const knownTypes = new Set(RSS_CONTENT_TYPES)
const jsonTypes = new Set(['application/feed+json', 'application/json'])

export function isFeedContentType(contentType: string): boolean {
  const mediaType = getMediaType(contentType)
  return mediaType !== null && (knownTypes.has(mediaType) || mediaType.endsWith('+xml'))
}

export function isJsonFeedContentType(contentType: string | null | undefined): boolean {
  const mediaType = contentType ? getMediaType(contentType) : null
  return mediaType !== null && jsonTypes.has(mediaType)
}

function getMediaType(contentType: string): string | null {
  try {
    return new MIMEType(contentType).essence
  } catch {
    return null
  }
}
