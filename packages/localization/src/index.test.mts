import { describe, expect, it } from 'vitest'
import {
  CANONICAL_SOURCE_LOCALE,
  DEFAULT_LOCALIZATION_BOUNDS,
  LocalizationBoundError,
  aliasEnglishLocale,
  assertLocalizationConsumer,
  assertMessageCount,
  assertPayloadBytes,
  assertPublicLocalizationConsumer,
  canonicalizeLocale,
  dedupeSelectors,
  firstAvailableTranslation,
  isLocalizationConsumer,
  isMessageId,
  isPublicLocalizationConsumer,
  leafForTranslation,
  normalizeLocale,
  normalizeLocaleList,
  normalizeLocalizationRequest,
  parseSelector,
  prefixRange,
  selectedIds,
  selectorMatches,
  uniqueConsumers,
} from './index.mts'

describe('localization runtime', () => {
  it('classifies consumers and rejects internal public use', () => {
    expect(isLocalizationConsumer('email')).toBe(true)
    expect(isPublicLocalizationConsumer('web')).toBe(true)
    expect(isPublicLocalizationConsumer('email')).toBe(false)
    expect(assertPublicLocalizationConsumer('web')).toBe('web')
    expect(assertLocalizationConsumer('swift')).toBe('swift')
    expect(uniqueConsumers(['email', 'web', 'web'])).toEqual(['web', 'email'])
    expect(() => assertLocalizationConsumer('android')).toThrow(/Unknown localization consumer/)
    expect(() => assertPublicLocalizationConsumer('email')).toThrow(/not public/)
  })

  it('canonicalizes locales and aliases en to en-US', () => {
    expect(canonicalizeLocale(' en_GB ')).toBe('en-GB')
    expect(canonicalizeLocale('not a tag!')).toBeNull()
    expect(canonicalizeLocale('en-US-u-ca-gregory-u-nu-latn')).toBeNull()
    const original = Intl.getCanonicalLocales
    try {
      Intl.getCanonicalLocales = () => []
      expect(canonicalizeLocale('en')).toBeNull()
    } finally {
      Intl.getCanonicalLocales = original
    }
    expect(aliasEnglishLocale('en')).toBe(CANONICAL_SOURCE_LOCALE)
    expect(normalizeLocale('EN')).toBe('en-US')
    expect(normalizeLocaleList(['en', 'es', 'en-US', 'fr'], ['en-US', 'es'])).toEqual([
      'en-US',
      'es',
    ])
    expect(() => normalizeLocaleList(['nope'])).toThrow(/Invalid locale/)
  })

  it('parses exact and terminal-prefix selectors and collapses overlap', () => {
    expect(isMessageId('nav.home')).toBe(true)
    expect(isMessageId('nav')).toBe(false)
    expect(parseSelector('nav.home')).toEqual({ kind: 'exact', id: 'nav.home' })
    expect(parseSelector('landing-page.*')).toEqual({ kind: 'prefix', prefix: 'landing-page' })
    expect(prefixRange('nav')).toEqual(['nav.', 'nav/'])
    expect(
      dedupeSelectors([
        parseSelector('nav.home'),
        parseSelector('nav.*'),
        parseSelector('nav.*'),
        parseSelector('nav.chrome.*'),
        parseSelector('common.save'),
      ]),
    ).toEqual([
      { kind: 'prefix', prefix: 'nav' },
      { kind: 'exact', id: 'common.save' },
    ])
    expect(() => parseSelector('')).toThrow(/non-empty/)
    expect(() => parseSelector('*.nav')).toThrow(/Invalid localization selector/)
    expect(() => parseSelector('nav.*.home')).toThrow(/Invalid localization selector/)
  })

  it('normalizes requests, applies bounds, and selects fallback leaves', () => {
    const request = normalizeLocalizationRequest({
      consumer: 'web',
      locales: ['en', 'es'],
      selectors: ['nav.*', 'nav.home'],
    })
    expect(request).toEqual({
      consumer: 'web',
      locales: ['en-US', 'es'],
      selectors: [{ kind: 'prefix', prefix: 'nav' }],
    })
    expect(selectedIds(['nav.home', 'nav.home'], request.selectors)).toEqual([
      'nav.home',
      'nav.home',
    ])
    expect(selectedIds(['nav.home', 'common.save'], request.selectors)).toEqual(['nav.home'])
    expect(selectorMatches({ kind: 'exact', id: 'nav.home' }, 'common.save')).toBe(false)
    expect(selectorMatches({ kind: 'prefix', prefix: 'nav' }, 'common.save')).toBe(false)
    expect(firstAvailableTranslation(['es', 'en-US'], { 'en-US': 'Home' })).toBe('Home')
    expect(firstAvailableTranslation(['fr'], { 'en-US': 'Home' })).toBeUndefined()
    expect(leafForTranslation(null, 'Home')).toBe('Home')
    expect(
      leafForTranslation(
        { kind: 'plural', valueParameter: 'count' },
        { one: '{count} one', other: '{count} other' },
      ),
    ).toEqual({
      kind: 'plural',
      valueParameter: 'count',
      forms: { one: '{count} one', other: '{count} other' },
    })
    expect(
      leafForTranslation(
        { kind: 'plural', valueParameter: 'count', numberParameters: ['count'] },
        { other: '{count}' },
      ),
    ).toMatchObject({ numberParameters: ['count'] })
    expect(
      leafForTranslation(
        { kind: 'select-plural', valueParameter: 'count', selectParameter: 'unit', cases: ['day'] },
        { day: { other: '{count} days' } },
      ),
    ).toMatchObject({ kind: 'select-plural', selectParameter: 'unit' })
    expect(
      leafForTranslation(
        {
          kind: 'select-plural',
          valueParameter: 'count',
          selectParameter: 'unit',
          numberParameters: ['count'],
          cases: ['day'],
        },
        { day: { other: '{count} days' } },
      ),
    ).toMatchObject({ numberParameters: ['count'] })
    expect(() => leafForTranslation(null, { other: 'x' })).toThrow(/String messages/)
    expect(() => leafForTranslation({ kind: 'plural', valueParameter: 'n' }, 'x')).toThrow(
      /Plural messages/,
    )
    expect(() =>
      leafForTranslation(
        { kind: 'select-plural', valueParameter: 'n', selectParameter: 'unit', cases: ['day'] },
        'x',
      ),
    ).toThrow(/Select-plural/)
    expect(() =>
      leafForTranslation(
        { kind: 'select-plural', valueParameter: 'n', selectParameter: 'unit', cases: ['day'] },
        { other: 'x' },
      ),
    ).toThrow(/Select-plural/)
    expect(() =>
      normalizeLocalizationRequest({ consumer: 'web', locales: [], selectors: ['nav.home'] }),
    ).toThrow(/At least one locale/)
    expect(() =>
      normalizeLocalizationRequest({ consumer: 'web', locales: ['en'], selectors: [] }),
    ).toThrow(/At least one selector/)
    expect(() =>
      normalizeLocalizationRequest(
        { consumer: 'web', locales: ['en', 'es', 'fr'], selectors: ['nav.home'] },
        null,
        { ...DEFAULT_LOCALIZATION_BOUNDS, maxLocales: 2 },
      ),
    ).toThrow(LocalizationBoundError)
    expect(() =>
      normalizeLocalizationRequest(
        { consumer: 'web', locales: ['en'], selectors: ['nav.home', 'nav.save'] },
        null,
        { ...DEFAULT_LOCALIZATION_BOUNDS, maxSelectors: 1 },
      ),
    ).toThrow(LocalizationBoundError)
    expect(() =>
      normalizeLocalizationRequest({ consumer: 'web', locales: ['de'], selectors: ['nav.home'] }, [
        'en-US',
      ]),
    ).toThrow(/No requested locales/)
    expect(() => assertMessageCount(3, { ...DEFAULT_LOCALIZATION_BOUNDS, maxMessages: 2 })).toThrow(
      LocalizationBoundError,
    )
    expect(() =>
      assertPayloadBytes('abcd', { ...DEFAULT_LOCALIZATION_BOUNDS, maxBytes: 3 }),
    ).toThrow(LocalizationBoundError)
    assertMessageCount(1, DEFAULT_LOCALIZATION_BOUNDS)
    assertPayloadBytes('ok', DEFAULT_LOCALIZATION_BOUNDS)
  })
})
