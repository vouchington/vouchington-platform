import { createHash } from 'node:crypto'
import { parseFeed } from 'feedsmith'
import { isJsonFeedContentType } from './content-types.mjs'
import { decodeFeed } from './decode.mjs'
export * from './content-types.mjs'
export { decodeFeed } from './decode.mjs'
/** Parses bytes from RSS, Atom, RDF, or JSON Feed into feedsmith's normalized document shape. */
export function parseFeedDocument(body, options = {}) {
  const contentType = options.contentType ?? null
  const text = isJsonFeedContentType(contentType)
    ? new TextDecoder('utf-8').decode(body)
    : decodeFeed(body, contentType)
  const feed = parseFeed(text).feed
  if (typeof feed !== 'object' || feed === null) throw new TypeError('Feed parser returned no feed')
  return {
    feed: feed,
    contentSha256: createHash('sha256').update(body).digest(),
  }
}
