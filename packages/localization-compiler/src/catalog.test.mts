import { describe, expect, it } from 'vitest'
import { sortedCatalog, validateLocalizationCatalog } from './catalog.mts'

const catalog = {
  copies: [{ id: 'copy.save', descriptor: null }],
  aliases: [{ consumer: 'web' as const, alias: 'web.nav.save', copyId: 'copy.save' }],
  translations: { 'en-US': [{ id: 'copy.save', value: 'Save' }] },
}

describe('canonical catalog validation', () => {
  it('sorts valid tables and rejects every referential contract break', () => {
    expect(sortedCatalog(catalog).copies).toEqual(catalog.copies)
    const invalid: readonly [string, unknown][] = [
      ['Duplicate copy id', { ...catalog, copies: [...catalog.copies, ...catalog.copies] }],
      [
        'targets missing copy',
        { ...catalog, aliases: [{ ...catalog.aliases[0], copyId: 'copy.nope' }] },
      ],
      ['Duplicate alias', { ...catalog, aliases: [...catalog.aliases, ...catalog.aliases] }],
      ['Locale', { ...catalog, translations: { en: catalog.translations['en-US'] } }],
      [
        'targets missing copy',
        { ...catalog, translations: { 'en-US': [{ id: 'copy.nope', value: 'x' }] } },
      ],
      [
        'Duplicate translation',
        {
          ...catalog,
          translations: {
            'en-US': [...catalog.translations['en-US'], ...catalog.translations['en-US']],
          },
        },
      ],
      ['missing en-US', { ...catalog, translations: {} }],
      [
        'Route selector',
        {
          ...catalog,
          routeMembership: [{ consumer: 'web', selectorId: 'web.route.x', alias: 'web.nope' }],
        },
      ],
      [
        'Duplicate route membership',
        {
          ...catalog,
          routeMembership: [
            { consumer: 'web', selectorId: 'web.route.x', alias: 'web.nav.save' },
            { consumer: 'web', selectorId: 'web.route.x', alias: 'web.nav.save' },
          ],
        },
      ],
      ['Editorial tag target', { ...catalog, tags: { 'copy.nope': ['chrome'] } }],
    ]
    for (const [message, value] of invalid)
      expect(() => validateLocalizationCatalog(value as typeof catalog)).toThrow(message)
  })
})
