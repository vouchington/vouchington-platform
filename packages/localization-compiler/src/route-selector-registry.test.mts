import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { chromeSelectorId, routeSelectorId, serializeCatalogTable } from '@vouchington/localization'
import {
  compileLocalizationSqlite,
  loadCatalogDirectory,
  openLocalizationDatabase,
  resolveLocalizationBatch,
} from './index.mts'

const paths: string[] = []

afterEach(() => paths.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })))

describe('pattern route membership', () => {
  it('expands disk rows, preserves empty selectors, and fails closed only for unknown exact selectors', async () => {
    const root = mkdtempSync(join(tmpdir(), 'catalog-route-selectors-'))
    paths.push(root)
    mkdirSync(join(root, 'translations'))
    writeFileSync(
      join(root, 'copies.json'),
      serializeCatalogTable([{ id: 'copy.posts', descriptor: null }]),
    )
    writeFileSync(
      join(root, 'aliases.json'),
      serializeCatalogTable([{ consumer: 'web', alias: 'web.nav.posts', copyId: 'copy.posts' }]),
    )
    writeFileSync(
      join(root, 'translations', 'en-US.json'),
      serializeCatalogTable([{ id: 'copy.posts', value: 'Posts' }]),
    )
    writeFileSync(
      join(root, 'routes.json'),
      serializeCatalogTable([
        { consumer: 'web', pattern: 'web.chrome', alias: 'web.nav.posts' },
        { consumer: 'web', pattern: '/empty' },
      ]),
    )

    const loaded = await loadCatalogDirectory(root)
    const chrome = chromeSelectorId(['web.nav.posts'])
    const empty = routeSelectorId('/empty', [])
    expect(loaded.catalog.routeMembership).toEqual([
      { consumer: 'web', selectorId: chrome, alias: 'web.nav.posts' },
    ])
    expect(loaded.catalog.routeSelectors).toEqual([
      { consumer: 'web', selectorId: chrome },
      { consumer: 'web', selectorId: empty },
    ])

    const output = join(root, 'catalog.sqlite')
    compileLocalizationSqlite(loaded.catalog, output)
    const database = openLocalizationDatabase(output)
    try {
      expect(
        resolveLocalizationBatch(database, {
          consumer: 'web',
          locales: ['en'],
          selectors: [chrome, empty],
        }).messages,
      ).toEqual({ 'web.nav.posts': 'Posts' })
      expect(
        resolveLocalizationBatch(database, {
          consumer: 'web',
          locales: ['en'],
          selectors: ['web.chrome.*'],
        }).messages,
      ).toEqual({ 'web.nav.posts': 'Posts' })
      expect(
        resolveLocalizationBatch(database, {
          consumer: 'web',
          locales: ['en'],
          selectors: [chrome, routeSelectorId('/missing', [])],
        }).messages,
      ).toEqual({})
      expect(() =>
        resolveLocalizationBatch(
          database,
          { consumer: 'web', locales: ['en'], selectors: [routeSelectorId('/missing', [])] },
          { bounds: { maxSelectors: 2, maxLocales: 1, maxMessages: 1, maxBytes: 10 } },
        ),
      ).toThrow(/payload exceeds/)
    } finally {
      database.close()
    }
  })

  it('rejects duplicate presence rows instead of silently collapsing them', async () => {
    const root = mkdtempSync(join(tmpdir(), 'catalog-duplicate-route-selectors-'))
    paths.push(root)
    mkdirSync(join(root, 'translations'))
    writeFileSync(join(root, 'copies.json'), '[]\n')
    writeFileSync(join(root, 'aliases.json'), '[]\n')
    writeFileSync(join(root, 'translations', 'en-US.json'), '[]\n')
    writeFileSync(
      join(root, 'routes.json'),
      serializeCatalogTable([
        { consumer: 'web', pattern: '/empty' },
        { consumer: 'web', pattern: '/empty' },
      ]),
    )
    await expect(loadCatalogDirectory(root)).rejects.toThrow(/Duplicate route selector/)
  })
})
