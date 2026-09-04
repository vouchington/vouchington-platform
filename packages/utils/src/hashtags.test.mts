import { describe, expect, it } from 'vitest'
import { createHashtagNormalizer, maskHashtagBearingUrls } from './hashtags.mts'

describe('hashtag normalization', () => {
  const normalizer = createHashtagNormalizer({
    maximumAuthoredLength: 255,
    maximumKeyLength: 255,
    separators: ['.', '_'],
  })

  it('applies caller-selected separators and retains authored input', () => {
    expect(normalizer.normalize(' #Me.Too__2026 ')).toEqual({
      authored: '#Me.Too__2026',
      key: 'me-too-2026',
    })
    expect(normalizer.normalizeQuery(' #Me.Too__2026- ')).toBe('me-too-2026-')
  })

  it('enforces caller-selected limits and the canonical ASCII grammar', () => {
    expect(normalizer.normalize('#-leading')).toBeNull()
    expect(normalizer.normalize('#trailing-')).toBeNull()
    expect(normalizer.normalize('#emoji-🙂')).toBeNull()
    expect(normalizer.normalize(`#${'a'.repeat(255)}`)).toBeNull()
    expect(normalizer.normalize(`#${'a'.repeat(254)}`)).toEqual({
      authored: `#${'a'.repeat(254)}`,
      key: 'a'.repeat(254),
    })
    expect(normalizer.normalize('')).toBeNull()
    expect(normalizer.normalize('#')).toBeNull()
  })

  it('supports literal multi-character separators and no separator policy', () => {
    const literal = createHashtagNormalizer({
      maximumAuthoredLength: 20,
      maximumKeyLength: 20,
      separators: ['::', '.', '', '.'],
    })
    expect(literal.normalize('#One::Two...Three')).toEqual({
      authored: '#One::Two...Three',
      key: 'one-two-three',
    })
    const overlapping = createHashtagNormalizer({
      maximumAuthoredLength: 20,
      maximumKeyLength: 20,
      separators: ['a', 'ab'],
    })
    expect(overlapping.normalizeQuery('#xaby')).toBe('x-y')
    const none = createHashtagNormalizer({
      maximumAuthoredLength: 20,
      maximumKeyLength: 20,
      separators: [],
    })
    expect(none.normalizeQuery('#one_two')).toBe('one_two')
    expect(none.normalize('#one_two')).toBeNull()
  })

  it('validates and snapshots caller-owned length policy', () => {
    expect(() =>
      createHashtagNormalizer({
        maximumAuthoredLength: Number.NaN,
        maximumKeyLength: 1,
        separators: [],
      }),
    ).toThrow(RangeError)
    expect(() =>
      createHashtagNormalizer({
        maximumAuthoredLength: 1,
        maximumKeyLength: -1,
        separators: [],
      }),
    ).toThrow(RangeError)
    const options = { maximumAuthoredLength: 5, maximumKeyLength: 3, separators: ['_'] }
    const snapshot = createHashtagNormalizer(options)
    options.maximumAuthoredLength = 0
    options.maximumKeyLength = 0
    expect(snapshot.normalize('#abc')).toEqual({ authored: '#abc', key: 'abc' })
    expect(snapshot.normalize('#abcd')).toBeNull()
  })
})

describe('maskHashtagBearingUrls', () => {
  it('masks absolute http(s) and www URLs including fragments', () => {
    expect(maskHashtagBearingUrls('See https://example.test/#pricing now')).toBe(
      `See ${' '.repeat('https://example.test/#pricing'.length)} now`,
    )
    expect(maskHashtagBearingUrls('See HTTP://example.test/plain now')).toBe(
      `See ${' '.repeat('HTTP://example.test/plain'.length)} now`,
    )
    expect(maskHashtagBearingUrls('See www.example.test/#also now')).toBe(
      `See ${' '.repeat('www.example.test/#also'.length)} now`,
    )
  })

  it('masks relative paths only when they contain a fragment', () => {
    expect(maskHashtagBearingUrls('Read /docs/plain then /docs/#x')).toBe(
      'Read /docs/plain then         ',
    )
  })

  it('keeps Wikipedia-style parentheses inside the URL token', () => {
    expect(
      maskHashtagBearingUrls(
        'https://en.wikipedia.org/wiki/Foo_(bar)#History /docs/(v2_(legacy))#History #visible',
      ),
    ).toBe(
      `${' '.repeat('https://en.wikipedia.org/wiki/Foo_(bar)#History'.length)} ${' '.repeat('/docs/(v2_(legacy))#History'.length)} #visible`,
    )
  })

  it('stops at whitespace, angle brackets, and unbalanced closing parentheses', () => {
    expect(maskHashtagBearingUrls('https://example.test/a>b')).toBe(
      `${' '.repeat('https://example.test/a'.length)}>b`,
    )
    expect(maskHashtagBearingUrls('https://example.test/a<b')).toBe(
      `${' '.repeat('https://example.test/a'.length)}<b`,
    )
    expect(maskHashtagBearingUrls('/Foo_(bar)#History)extra')).toBe(
      `${' '.repeat('/Foo_(bar)#History'.length)})extra`,
    )
    expect(maskHashtagBearingUrls('/Foo_(bar))#outside')).toBe('/Foo_(bar))#outside')
  })
})
