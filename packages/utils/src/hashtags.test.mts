import { describe, expect, it } from 'vitest'
import { createHashtagNormalizer } from './hashtags.mts'

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
