import { describe, expect, it } from 'vitest'
import {
  decodeFeed,
  isFeedContentType,
  isJsonFeedContentType,
  parseFeedDocument,
} from './index.mts'

describe('rss parser', () => {
  it('recognizes supported feed content types', () => {
    expect(isFeedContentType('application/atom+xml; charset=utf-8')).toBe(true)
    expect(isFeedContentType('application/custom+xml')).toBe(true)
    expect(isFeedContentType('text/html')).toBe(false)
    expect(isFeedContentType('bad')).toBe(false)
    expect(isJsonFeedContentType('application/json')).toBe(true)
    expect(isJsonFeedContentType(null)).toBe(false)
  })

  it('decodes declared charset and parses RSS documents', () => {
    const body = Buffer.from(
      '<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel><title>Feed</title><item><title>One</title><link>https://example.test/one</link></item></channel></rss>',
    )
    expect(decodeFeed(body, 'application/rss+xml; charset=utf-8')).toContain('<rss')
    const parsed = parseFeedDocument(body, { contentType: 'application/rss+xml' })
    expect(parsed.feed.title).toBe('Feed')
    expect(Buffer.from(parsed.contentSha256)).toHaveLength(32)
    expect(parseFeedDocument(body).feed.title).toBe('Feed')
  })

  it('replaces malformed bytes in explicitly UTF-8 feeds without corrupting valid text', () => {
    const prefix = Buffer.from('<?xml version="1.0" encoding="utf-8"?><rss><channel><title>Résumé ')
    const suffix = Buffer.from('</title></channel></rss>')
    const body = Buffer.concat([prefix, Buffer.from([0x93]), suffix])

    expect(decodeFeed(body, 'application/rss+xml; charset=utf-8')).toContain(
      '<title>Résumé �</title>',
    )
  })

  it('parses JSON Feed and rejects an empty parser result', () => {
    const body = Buffer.from(
      '{"version":"https://jsonfeed.org/version/1.1","title":"Feed","items":[]}',
    )
    expect(parseFeedDocument(body, { contentType: 'application/feed+json' }).feed.title).toBe(
      'Feed',
    )
    expect(decodeFeed(Buffer.from([0xff]), 'charset=made-up')).toBe('ÿ')
    expect(decodeFeed(Buffer.from([0xff, 0xfe, 0x61, 0x00]))).toBe('a')
    expect(decodeFeed(Buffer.from([0xfe, 0xff, 0x00, 0x61]))).toBe('a')
    expect(decodeFeed(Buffer.from('<?xml version="1.0"?><rss/>', 'utf16le'))).toContain('<rss')
    expect(decodeFeed(toUtf16Be('<?xml version="1.0"?><rss/>'))).toContain('<rss')
    expect(decodeFeed(Buffer.from([0xef, 0xbb, 0xbf, 0x61]))).toContain('a')
    expect(decodeFeed(Buffer.from('<?xml version="1.0" encoding="utf-8"?><rss/>'))).toContain(
      '<rss',
    )
  })
})

function toUtf16Be(value: string): Uint8Array {
  const littleEndian = Buffer.from(value, 'utf16le')
  for (let index = 0; index < littleEndian.length; index += 2) {
    const first = littleEndian[index]
    littleEndian[index] = littleEndian[index + 1] ?? 0
    littleEndian[index + 1] = first ?? 0
  }
  return littleEndian
}
