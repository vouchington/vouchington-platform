import { describe, expect, it } from 'vitest'
import {
  canonicalJson,
  catalogMessageFromRecord,
  compareCodePoints,
  createLocalizationBatch,
  descriptorSignature,
  etagMatches,
  isPluralForms,
  isSelectPluralCases,
  isTranslationValue,
  localizationEtag,
  parseDescriptor,
  placeholdersIn,
  serializeCatalogMessages,
  serializeLocalizationBatch,
  uniquePlaceholders,
  assertSamePlaceholders,
  translationMatchesDescriptor,
} from './index.mts'

describe('catalog serialization and descriptors', () => {
  it('serializes catalogs, batches, and ETags deterministically', () => {
    const messages = [
      catalogMessageFromRecord({
        id: 'nav.home',
        consumers: ['web'],
        descriptor: null,
        translations: { 'en-US': 'Home', es: 'Inicio' },
      }),
      catalogMessageFromRecord({
        id: 'common.save',
        consumers: ['swift', 'web'],
        translations: { 'en-US': 'Save' },
      }),
    ]
    expect(serializeCatalogMessages(messages)).toContain('"id":"common.save"')
    expect(serializeCatalogMessages(messages)).toBe(
      serializeCatalogMessages([...messages].reverse()),
    )
    const batch = createLocalizationBatch('abc', 60, { 'nav.home': 'Home', 'common.save': 'Save' })
    expect(serializeLocalizationBatch(batch)).toContain('"contract":"v1"')
    expect(localizationEtag('abc')).toBe('"abc"')
    expect(etagMatches('"abc"', 'abc')).toBe(true)
    expect(etagMatches('W/"abc"', 'abc')).toBe(true)
    expect(etagMatches('"other", "abc"', 'abc')).toBe(true)
    expect(etagMatches('   ', 'abc')).toBe(false)
    expect(etagMatches('', 'abc')).toBe(false)
    expect(etagMatches(null, 'abc')).toBe(false)
    expect(etagMatches('"nope"', 'abc')).toBe(false)
    expect(() => createLocalizationBatch('abc', 0, {})).toThrow(/ttlSeconds/)
    expect(() => createLocalizationBatch('abc', 1.5, {})).toThrow(/ttlSeconds/)
    expect(canonicalJson({ b: 1, a: [true, null, 'x'] })).toBe('{"a":[true,null,"x"],"b":1}')
    expect(compareCodePoints('a', 'b')).toBe(-1)
    expect(compareCodePoints('b', 'a')).toBe(1)
    expect(compareCodePoints('a', 'a')).toBe(0)
    expect(canonicalJson([])).toBe('[]')
    expect(canonicalJson({})).toBe('{}')
    expect(() => canonicalJson(undefined)).toThrow(/Cannot serialize/)
  })

  it('parses descriptors and validates translation values', () => {
    expect(parseDescriptor(null)).toBeNull()
    expect(parseDescriptor({ kind: 'plural', valueParameter: 'count' })).toEqual({
      kind: 'plural',
      valueParameter: 'count',
    })
    expect(
      parseDescriptor({ kind: 'plural', valueParameter: 'count', numberParameters: ['count'] }),
    ).toEqual({ kind: 'plural', valueParameter: 'count', numberParameters: ['count'] })
    expect(
      parseDescriptor({
        kind: 'select-plural',
        valueParameter: 'count',
        selectParameter: 'unit',
        cases: ['day'],
      }),
    ).toMatchObject({ kind: 'select-plural', cases: ['day'] })
    expect(
      parseDescriptor({
        kind: 'select-plural',
        valueParameter: 'count',
        selectParameter: 'unit',
        numberParameters: ['count'],
        cases: ['day'],
      }),
    ).toMatchObject({ numberParameters: ['count'] })
    expect(isPluralForms({ other: 'x', one: 'y' })).toBe(true)
    expect(isPluralForms({ other: 'x', nope: 'y' })).toBe(false)
    expect(isPluralForms(null)).toBe(false)
    expect(isSelectPluralCases({ day: { other: 'x' } })).toBe(true)
    expect(isSelectPluralCases({})).toBe(false)
    expect(isTranslationValue('Home')).toBe(true)
    expect(isTranslationValue({ foo: 'bar' })).toBe(false)
    expect(translationMatchesDescriptor(null, 'Save')).toBe(true)
    expect(translationMatchesDescriptor(null, { other: 'x' })).toBe(false)
    expect(
      translationMatchesDescriptor({ kind: 'plural', valueParameter: 'count' }, { other: 'x' }),
    ).toBe(true)
    expect(translationMatchesDescriptor({ kind: 'plural', valueParameter: 'count' }, 'Save')).toBe(
      false,
    )
    const select = {
      kind: 'select-plural' as const,
      valueParameter: 'count',
      selectParameter: 'unit',
      cases: ['day'],
    }
    expect(translationMatchesDescriptor(select, { day: { other: '{count} days' } })).toBe(true)
    expect(translationMatchesDescriptor(select, 'Save')).toBe(false)
    expect(translationMatchesDescriptor(select, { other: 'x' })).toBe(false)
    expect(translationMatchesDescriptor(select, { hour: { other: 'x' } })).toBe(false)
    expect(descriptorSignature({ kind: 'plural', valueParameter: 'n' })).toContain('plural')
    expect(
      descriptorSignature({
        kind: 'select-plural',
        valueParameter: 'n',
        selectParameter: 'unit',
        cases: ['b', 'a'],
      }),
    ).toContain('select-plural')
    expect(placeholdersIn('Hello {name} and {name}')).toEqual(['name', 'name'])
    expect(uniquePlaceholders(['{b}', '{a}'])).toEqual(['a', 'b'])
    assertSamePlaceholders(['a'], ['a'], 'id')
    expect(() => assertSamePlaceholders(['a'], ['b'], 'id')).toThrow(/Placeholder mismatch/)
    expect(() => parseDescriptor({ kind: 'plural' })).toThrow(/Invalid message descriptor/)
    expect(() => parseDescriptor({ kind: 'other', valueParameter: 'n' })).toThrow(/Invalid/)
    expect(() => parseDescriptor({ kind: 'plural', valueParameter: 'n', extra: true })).toThrow(
      /Invalid message descriptor/,
    )
    expect(() =>
      parseDescriptor({
        kind: 'select-plural',
        valueParameter: 'n',
        selectParameter: 'u',
        cases: ['day'],
        extra: true,
      }),
    ).toThrow(/Invalid message descriptor/)
    expect(() =>
      parseDescriptor({
        kind: 'select-plural',
        valueParameter: 'n',
        selectParameter: 'u',
        cases: [1],
      }),
    ).toThrow(/cases/)
    expect(() =>
      parseDescriptor({ kind: 'plural', valueParameter: 'n', numberParameters: [1] }),
    ).toThrow(/numberParameters/)
    expect(() => catalogMessageFromRecord({ id: 'bad' })).toThrow(/valid id/)
    expect(() =>
      catalogMessageFromRecord({ id: 'nav.home', consumers: [], translations: { 'en-US': 'x' } }),
    ).toThrow(/consumers/)
    expect(() =>
      catalogMessageFromRecord({ id: 'nav.home', consumers: ['web'], translations: {} }),
    ).toThrow(/translations/)
  })
})
