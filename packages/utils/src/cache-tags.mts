import { normalizeKey } from './strings.mjs'

/** Maximum accepted Cache-Tag byte length at the wire boundary. */
export const MAX_CACHE_TAG_BYTES = 1024
const CACHE_TAG_CHARSET = /^[\x21-\x2b\x2d-\x7e]+$/

/** Check whether one tag is printable ASCII without spaces or commas and fits the wire limit. */
export function isValidCacheTag(tag: string): boolean {
  return tag.length > 0 && tag.length <= MAX_CACHE_TAG_BYTES && CACHE_TAG_CHARSET.test(tag)
}

/** Decode exactly one URL pathname segment. Never pass raw database values through this function. */
export function decodeCacheTagPathSegment(segment: string): string {
  if (!segment.includes('%')) return segment
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/** Encode a raw identifier; percent escapes in raw values remain literal identifier text. */
export function encodeCacheTagValue(value: string): string {
  return encodeURIComponent(normalizeKey(value)).toLowerCase()
}

/** Mint a bounded tag for a caller supplied family and raw identifier. */
export function cacheTag(family: string, value: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(family) || family.length >= MAX_CACHE_TAG_BYTES) {
    throw new TypeError('Cache tag family must be a bounded lowercase ASCII token')
  }
  return truncateCacheTag(`${family}:${encodeCacheTagValue(value)}`)
}

function truncateCacheTag(tag: string): string {
  if (tag.length <= MAX_CACHE_TAG_BYTES) return tag
  let end = MAX_CACHE_TAG_BYTES
  if (tag[end - 1] === '%') end -= 1
  else if (tag[end - 2] === '%') end -= 2
  return tag.slice(0, end)
}
