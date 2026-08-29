import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  bestAcceptLanguageMatch,
  normalizeLanguageTag,
  parseAcceptLanguage,
} from './language-tags.mts'

describe('language tags', () => {
  it('normalizes caller-configured ordinary locale values', () => {
    const supported = ['en', 'pt-BR', 'fr'] as const
    expect(normalizeLanguageTag(' PT_br ', supported)).toBe('pt-BR')
    expect(normalizeLanguageTag('fr-CA', supported)).toBe('fr')
    expect(normalizeLanguageTag('invalid_tag!', supported)).toBeNull()
    expect(normalizeLanguageTag(null, supported)).toBeNull()
    expectTypeOf(normalizeLanguageTag('en', supported)).toEqualTypeOf<
      'en' | 'pt-BR' | 'fr' | null
    >()
  })
  it('parses strict Accept-Language ranges in stable quality order', () => {
    expect(parseAcceptLanguage('fr;q=0.8, EN-us;q=1.000, de;q=0.8, en;q=0')).toEqual([
      { range: 'en-US', quality: 1, index: 1 },
      { range: 'fr', quality: 0.8, index: 0 },
      { range: 'de', quality: 0.8, index: 2 },
    ])
    expect(parseAcceptLanguage('en_US, fr;q=1.0000, de;q=oops, pt;level=1, *;q=0')).toEqual([])
    expect(parseAcceptLanguage('en-u-ca-gregory;q=0.5, en;q=0.5')).toEqual([
      { range: 'en-u-ca-gregory', quality: 0.5, index: 0 },
      { range: 'en', quality: 0.5, index: 1 },
    ])
    expect(parseAcceptLanguage('en;q=0., fr;q=1., de;q=0.2, de;q=0.8')).toEqual([
      { range: 'fr', quality: 1, index: 1 },
      { range: 'de', quality: 0.8, index: 3 },
      { range: 'de', quality: 0.2, index: 2 },
    ])
    expect(parseAcceptLanguage(null)).toEqual([])
    expect(parseAcceptLanguage('en;q=0.5;level=1, fr;q=not-a-number, ;q=1')).toEqual([])
  })
  it('best-matches valid configured languages including wildcards and request truncation', () => {
    const supported = ['fr', 'en', 'pt-BR', 'not a locale'] as const
    expect(bestAcceptLanguageMatch('pt-BR, en;q=0.8', supported)).toBe('pt-BR')
    expect(bestAcceptLanguageMatch('en-US, fr;q=0.9', supported)).toBe('en')
    expect(bestAcceptLanguageMatch('de, *;q=0.5', supported)).toBe('fr')
    expect(bestAcceptLanguageMatch('de;q=0, fr;q=0', supported)).toBeNull()
    expect(bestAcceptLanguageMatch('en-US;q=0, *;q=1', ['en-US', 'fr'] as const)).toBe('fr')
    expect(bestAcceptLanguageMatch('en;q=0, *;q=1', ['en-US', 'en', 'fr'] as const)).toBe('fr')
    expect(bestAcceptLanguageMatch('en;q=0, en;q=1, *;q=0.5', ['en', 'fr'] as const)).toBe('fr')
    expect(bestAcceptLanguageMatch('*;q=0, en;q=1', ['fr', 'en'] as const)).toBe('en')
    expect(bestAcceptLanguageMatch('en;q=0, en-US;q=1', ['en-US', 'fr'] as const)).toBe('en-US')
    expect(bestAcceptLanguageMatch('en;q=0, *;q=1', ['en', 'fr'] as const)).toBe('fr')
    expect(bestAcceptLanguageMatch('en;q=0, en;q=1', ['en', 'fr'] as const)).toBeNull()
    expect(bestAcceptLanguageMatch('en-US;q=1, en;q=0', ['en'] as const)).toBeNull()
    expect(bestAcceptLanguageMatch('en-US;q=1, *;q=0', ['en'] as const)).toBeNull()
    expect(bestAcceptLanguageMatch('fr-CA;q=1, *;q=0', ['fr'] as const)).toBeNull()
    expect(bestAcceptLanguageMatch('fr;q=0, *;q=1', ['not a locale'] as const)).toBeNull()
  })
})
