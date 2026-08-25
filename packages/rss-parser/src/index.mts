import { createHash } from 'node:crypto'
import { parseFeed } from 'feedsmith'
import { isJsonFeedContentType } from './content-types.mts'
import { decodeFeed } from './decode.mts'

export * from './content-types.mts'
export { decodeFeed } from './decode.mts'

export type ParsedFeed = Record<string, unknown>

export interface ParsedFeedDocument {
  feed: ParsedFeed
  contentSha256: Uint8Array
}

/** Parses bytes from RSS, Atom, RDF, or JSON Feed into feedsmith's normalized document shape. */
export function parseFeedDocument(
  body: Uint8Array,
  options: { contentType?: string | null } = {},
): ParsedFeedDocument {
  const contentType = options.contentType ?? null
  const text = isJsonFeedContentType(contentType)
    ? new TextDecoder('utf-8').decode(body)
    : decodeFeed(body, contentType)
  const feed = parseFeed(text).feed as ParsedFeed
  return {
    feed,
    contentSha256: createHash('sha256').update(body).digest(),
  }
}
