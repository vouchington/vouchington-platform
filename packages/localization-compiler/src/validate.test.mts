import { describe, expect, it } from 'vitest'
import { parseCatalogFile, validateCatalogMessages } from './index.mts'
import { sampleMessages } from './test-helpers.mts'

describe('catalog validation', () => {
  it('accepts complete en-US with sparse locales and namespace documents', () => {
    expect(parseCatalogFile({ messages: sampleMessages().slice(0, 1) })).toHaveLength(1)
    expect(parseCatalogFile(sampleMessages().slice(0, 1))[0]?.id).toBe('nav.home')
    expect(() => validateCatalogMessages(sampleMessages())).not.toThrow()
  })

  it('rejects missing en-US, duplicates, aliases, and placeholder drift', () => {
    expect(() => parseCatalogFile({})).toThrow(/array or \{ messages \}/)
    expect(() =>
      validateCatalogMessages([{ ...sampleMessages()[0]!, translations: { es: 'Inicio' } }]),
    ).toThrow(/missing en-US/)
    expect(() =>
      validateCatalogMessages([...sampleMessages().slice(0, 1), ...sampleMessages().slice(0, 1)]),
    ).toThrow(/Duplicate message id/)
    expect(() =>
      validateCatalogMessages([
        { ...sampleMessages()[0]!, translations: { 'en-US': 'Home', en: 'Home' } },
      ]),
    ).toThrow(/must be stored as/)
    expect(() =>
      validateCatalogMessages([
        { ...sampleMessages()[0]!, translations: { 'en-US': 'Home', 'not a locale!': 'X' } },
      ]),
    ).toThrow(/Invalid locale/)
    expect(() =>
      validateCatalogMessages([
        {
          ...sampleMessages()[1]!,
          translations: { 'en-US': 'Save "{name}"', es: 'Guardar' },
        },
      ]),
    ).toThrow(/Placeholder mismatch/)
    expect(() =>
      validateCatalogMessages([
        {
          ...sampleMessages()[2]!,
          translations: { 'en-US': 'item' },
        },
      ]),
    ).toThrow(/invalid forms/)
    expect(() =>
      validateCatalogMessages([
        {
          ...sampleMessages()[3]!,
          translations: { 'en-US': { hour: { other: '{value}' } } },
        },
      ]),
    ).toThrow(/cases mismatch/)
    expect(() =>
      validateCatalogMessages([
        {
          id: 'nav.home',
          descriptor: null,
          consumers: ['web'],
          translations: { 'en-US': { other: 'x' } },
        },
      ]),
    ).toThrow(/non-string value/)
    expect(() =>
      validateCatalogMessages([
        {
          ...sampleMessages()[3]!,
          translations: { 'en-US': { one: '{value}', other: '{value}' } },
        },
      ]),
    ).toThrow(/invalid cases/)
    expect(() =>
      validateCatalogMessages([
        { ...sampleMessages()[0]!, translations: { 'en-US': 'Home', en_US: 'Home' } },
      ]),
    ).toThrow(/must be stored as/)
    expect(() => parseCatalogFile({ messages: [null] })).toThrow(/valid id/)
    expect(() =>
      validateCatalogMessages([
        {
          ...sampleMessages()[2]!,
          translations: { 'en-US': { day: { other: '{count}' } } },
        },
      ]),
    ).toThrow(/invalid forms/)
    expect(() =>
      validateCatalogMessages([
        {
          ...sampleMessages()[3]!,
          translations: { 'en-US': { foo: 'bar' } as never },
        },
      ]),
    ).toThrow(/invalid cases/)
  })
})
