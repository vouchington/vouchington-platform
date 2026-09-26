import { describe, expect, it } from 'vitest'
import {
  MAX_CACHE_TAG_BYTES,
  cacheTag,
  decodeCacheTagPathSegment,
  encodeCacheTagValue,
  isValidCacheTag,
} from './cache-tags.mts'

describe('cache-tag wire encoding', () => {
  it.each([
    ['new york', 'new%20york'],
    ['a\tb', 'a%09b'],
    ['café', 'caf%c3%a9'],
    ['日本', '%e6%97%a5%e6%9c%ac'],
    ['a,b', 'a%2cb'],
    ['a/b', 'a%2fb'],
    ['100%', '100%25'],
  ])('encodes %s as %s', (raw, encoded) => {
    expect(encodeCacheTagValue(raw)).toBe(encoded)
    expect(cacheTag('topic', raw)).toBe(`topic:${encoded}`)
    expect(isValidCacheTag(cacheTag('topic', raw))).toBe(true)
  })

  it('normalizes raw identifier casing and whitespace', () => {
    expect(cacheTag('topic', ' Alice ')).toBe('topic:alice')
    expect(cacheTag('post', 'ABC')).toBe('post:abc')
  })

  it('converges across URL and raw database values without decoding raw escapes', () => {
    for (const raw of ['café', 'new york', 'sale%20day', 'a/b', '日本']) {
      const pathnameSegment = encodeURIComponent(raw)
      expect(cacheTag('topic', decodeCacheTagPathSegment(pathnameSegment))).toBe(
        cacheTag('topic', raw),
      )
    }
    expect(cacheTag('topic', 'sale%20day')).toBe('topic:sale%2520day')
  })

  it.each(['%zz', 'abc%a', '100%', '%80'])('keeps malformed segment %s verbatim', (segment) => {
    expect(decodeCacheTagPathSegment(segment)).toBe(segment)
    expect(cacheTag('topic', decodeCacheTagPathSegment(segment))).toBe(cacheTag('topic', segment))
  })

  it('checks printable ASCII wire constraints and families', () => {
    expect(isValidCacheTag('')).toBe(false)
    expect(isValidCacheTag('a b')).toBe(false)
    expect(isValidCacheTag('café')).toBe(false)
    expect(isValidCacheTag('a'.repeat(MAX_CACHE_TAG_BYTES + 1))).toBe(false)
    expect(isValidCacheTag('a'.repeat(MAX_CACHE_TAG_BYTES))).toBe(true)
    expect(() => cacheTag('bad family', 'x')).toThrow(TypeError)
    expect(() => cacheTag('a'.repeat(MAX_CACHE_TAG_BYTES), 'x')).toThrow(TypeError)
  })

  it('truncates at escape boundaries without dropping the tag', () => {
    for (const [family, raw, expectedLength] of [
      ['topic', 'é'.repeat(1000), MAX_CACHE_TAG_BYTES - 1],
      ['user', ','.repeat(500), MAX_CACHE_TAG_BYTES - 2],
      ['user', 'a'.repeat(2000), MAX_CACHE_TAG_BYTES],
    ] as const) {
      const tag = cacheTag(family, raw)
      expect(tag.length).toBe(expectedLength)
      expect(isValidCacheTag(tag)).toBe(true)
      expect(/%[0-9a-f]?$/.test(tag)).toBe(false)
      expect(cacheTag(family, decodeCacheTagPathSegment(encodeURIComponent(raw)))).toBe(tag)
    }
  })
})
