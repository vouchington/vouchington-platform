import { describe, expect, it } from 'vitest'
import {
  catalogRevision,
  exportCatalogCsv,
  exportLocalizationCsv,
  importCatalogCsv,
  importLocalizationCsv,
  sortedCatalog,
} from './index.mts'
import { csvRecord } from './csv.mts'
import { sampleMessages } from './test-helpers.mts'

describe('csv interchange', () => {
  it('round-trips catalogs without compiling CSV to sqlite', () => {
    const messages = sampleMessages()
    const csv = exportLocalizationCsv(messages)
    expect(importLocalizationCsv(csv, { expectedRevision: catalogRevision(messages) })).toEqual(
      messages,
    )
  })

  it('round-trips canonical copy rows and rejects stale revisions', () => {
    const catalog = {
      copies: [{ id: 'copy.save', descriptor: null }],
      aliases: [{ consumer: 'web' as const, alias: 'web.nav.save', copyId: 'copy.save' }],
      translations: { 'en-US': [{ id: 'copy.save', value: 'Save' }] },
    }
    const csv = exportCatalogCsv(catalog)
    expect(importCatalogCsv(csv)).toMatchObject(catalog)
    expect(() => importCatalogCsv(csv, 'stale')).toThrow(/source contract hash/)
    expect(() => importCatalogCsv('bad\n')).toThrow(/header/)
  })

  it('treats catalog CSV as an authoring interchange excluding generated routes and tags', () => {
    const catalog = {
      copies: [{ id: 'copy.save', descriptor: null }],
      aliases: [{ consumer: 'web' as const, alias: 'web.nav.save', copyId: 'copy.save' }],
      translations: { 'en-US': [{ id: 'copy.save', value: 'Save' }] },
      routeMembership: [
        { consumer: 'web' as const, selectorId: 'web.route.home', alias: 'web.nav.save' },
      ],
      routeSelectors: [{ consumer: 'web' as const, selectorId: 'web.route.home' }],
      tags: { 'copy.save': ['chrome'] },
    }
    const imported = importCatalogCsv(exportCatalogCsv(catalog))
    expect(imported.copies).toEqual(catalog.copies)
    expect(imported.aliases).toEqual(catalog.aliases)
    expect(imported.translations).toEqual(catalog.translations)
    expect(imported.routeMembership ?? []).toEqual([])
    expect(imported.routeSelectors ?? []).toEqual([])
    expect(imported.tags ?? {}).toEqual({})
    expect(catalogRevision(imported)).toBe(
      catalogRevision(
        sortedCatalog({
          copies: catalog.copies,
          aliases: catalog.aliases,
          translations: catalog.translations,
        }),
      ),
    )
  })

  it('rejects malformed canonical CSV rows and mixed revisions', () => {
    const catalog = {
      copies: [{ id: 'copy.save', descriptor: null }],
      aliases: [{ consumer: 'web' as const, alias: 'web.nav.save', copyId: 'copy.save' }],
      translations: { 'en-US': [{ id: 'copy.save', value: 'Save' }] },
    }
    const [header, row] = exportCatalogCsv(catalog).trimEnd().split('\n')
    expect(() =>
      importCatalogCsv(`${header}\n${row}\n${row!.replace(/[^,]+$/, 'other')}\n`),
    ).toThrow(/single catalog_revision/)
    expect(() =>
      importCatalogCsv(`${header}\n${row!.replace('copy.save', 'copy.other')}\n`),
    ).toThrow(/reconstructed catalog/)
  })

  it('rejects header, duplicate, revision, and empty-row contract breaks', () => {
    expect(() => importLocalizationCsv('nope\n')).toThrow(/CSV header/)
    const csv = exportLocalizationCsv(sampleMessages())
    const [header, ...rows] = csv.trimEnd().split('\n')
    expect(() => importLocalizationCsv(`${header}\n`)).toThrow(/no data rows/)
    expect(() => importLocalizationCsv(`${header}\n${rows[0]}\n${rows[0]}\n`)).toThrow(
      /Duplicate CSV row/,
    )
    expect(() =>
      importLocalizationCsv(`${header}\n${rows[0]!.replace(/,[^,]+$/, ',deadbeef')}\n`),
    ).toThrow(/reconstructed catalog/)
    expect(() => importLocalizationCsv(csv, { expectedRevision: 'nope' })).toThrow(
      /source contract hash/,
    )
    const mixed = `${header}\n${rows[0]}\n${rows[1]!.replace(/,[^,]+$/, ',otherhash')}\n`
    expect(() => importLocalizationCsv(mixed)).toThrow(/share a single catalog_revision/)
    expect(() => csvRecord([])).toThrow(/missing id/)
  })
})
