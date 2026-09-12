import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalizationBoundError, etagMatches, localizationEtag } from '@vouchington/localization'
import {
  compileLocalizationSqlite,
  explainLocalizationPlan,
  loadCatalogDirectory,
  openLocalizationDatabase,
  resolveLocalizationBatch,
} from './index.mts'
import { sampleMessages, writeCatalog } from './test-helpers.mts'

const paths: string[] = []

afterEach(() => {
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('sqlite compile and resolve', () => {
  it('compiles a shared revision and resolves overlapping selectors with locale fallback', async () => {
    const source = writeCatalog({
      'nav.json': sampleMessages().slice(0, 2),
      'settings.json': sampleMessages().slice(2),
      'tags.json': { 'nav.home': ['chrome', 'chrome'] },
    })
    paths.push(source)
    const loaded = await loadCatalogDirectory(source)
    expect(loaded.tags['nav.home']).toEqual(['chrome'])
    const output = join(mkdtempSync(join(tmpdir(), 'sqlite-')), 'catalog.sqlite')
    paths.push(output)
    const revision = compileLocalizationSqlite(loaded.messages, output, loaded.tags)
    const database = openLocalizationDatabase(output, { cacheKb: 1024 })
    try {
      expect(database.revision).toBe(revision)
      const batch = resolveLocalizationBatch(database, {
        consumer: 'web',
        locales: ['es', 'en'],
        selectors: ['nav.*', 'nav.home', 'common.save', 'settings.count'],
      })
      expect(batch.messages['nav.home']).toBe('Inicio')
      expect(batch.messages['common.save']).toBe('Save "{name}"')
      expect(batch.messages['settings.count']).toMatchObject({ kind: 'plural' })
      expect(batch.messages['settings.ago']).toBeUndefined()
      expect(etagMatches(localizationEtag(revision), revision)).toBe(true)
      const email = resolveLocalizationBatch(database, {
        consumer: 'email',
        locales: ['en-US'],
        selectors: ['settings.ago'],
      })
      expect(email.messages['settings.ago']).toMatchObject({ kind: 'select-plural' })
      const missingLocale = resolveLocalizationBatch(database, {
        consumer: 'web',
        locales: ['fr'],
        selectors: ['nav.home'],
      })
      expect(missingLocale.messages['nav.home']).toBeUndefined()
      const plan = explainLocalizationPlan(database, { kind: 'prefix', prefix: 'nav' })
      expect(plan.length).toBeGreaterThan(0)
      expect(
        explainLocalizationPlan(database, { kind: 'exact', id: 'nav.home' }).length,
      ).toBeGreaterThan(0)
      expect(() =>
        database.sqlite.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)').run('x', 'y'),
      ).toThrow()
    } finally {
      database.close()
    }
  })

  it('fails closed on corrupt artifacts, missing metadata, and bounds', async () => {
    const source = writeCatalog({ 'nav.json': [sampleMessages()[0]] })
    paths.push(source)
    const directory = mkdtempSync(join(tmpdir(), 'sqlite-'))
    paths.push(directory)
    const output = join(directory, 'catalog.sqlite')
    compileLocalizationSqlite((await loadCatalogDirectory(source)).messages, output)
    const writable = new DatabaseSync(output)
    writable.prepare("UPDATE metadata SET value = 'v0' WHERE key = 'contract'").run()
    writable.close()
    expect(() => openLocalizationDatabase(output)).toThrow(/Unsupported localization contract/)
    const missing = join(directory, 'missing.sqlite')
    compileLocalizationSqlite([sampleMessages()[0]!], missing)
    const stripped = new DatabaseSync(missing)
    stripped.prepare("DELETE FROM metadata WHERE key = 'revision'").run()
    stripped.close()
    expect(() => openLocalizationDatabase(missing)).toThrow(/missing metadata/)
    const corrupt = join(directory, 'corrupt.sqlite')
    compileLocalizationSqlite([sampleMessages()[0]!], corrupt)
    const { readFileSync, writeFileSync } = await import('node:fs')
    writeFileSync(corrupt, readFileSync(corrupt).subarray(0, 64))
    expect(() => openLocalizationDatabase(corrupt)).toThrow(/malformed/)
    const database = openLocalizationDatabase(compilePath(directory, [sampleMessages()[0]!]))
    try {
      expect(() =>
        resolveLocalizationBatch(
          database,
          { consumer: 'web', locales: ['en'], selectors: ['nav.home'] },
          { bounds: { maxLocales: 8, maxSelectors: 32, maxMessages: 0, maxBytes: 512 * 1024 } },
        ),
      ).toThrow(LocalizationBoundError)
      expect(() =>
        resolveLocalizationBatch(
          database,
          { consumer: 'web', locales: ['en'], selectors: ['nav.home'] },
          { bounds: { maxLocales: 8, maxSelectors: 32, maxMessages: 1, maxBytes: 10 } },
        ),
      ).toThrow(LocalizationBoundError)
    } finally {
      database.close()
    }
  })

  it('rejects empty catalogs and unknown editorial tags', async () => {
    const empty = writeCatalog({ 'tags.json': {} })
    paths.push(empty)
    await expect(loadCatalogDirectory(empty)).rejects.toThrow(/No catalog messages/)
    const unknown = writeCatalog({
      'nav.json': [sampleMessages()[0]],
      'tags.json': { 'missing.id': ['x'] },
    })
    paths.push(unknown)
    await expect(loadCatalogDirectory(unknown)).rejects.toThrow(/Editorial tag target/)
    const invalidTags = writeCatalog({ 'tags.json': [] })
    paths.push(invalidTags)
    await expect(loadCatalogDirectory(invalidTags)).rejects.toThrow(/tags.json must be an object/)
    const badTag = writeCatalog({
      'nav.json': [sampleMessages()[0]],
      'tags.json': { 'nav.home': [1] },
    })
    paths.push(badTag)
    await expect(loadCatalogDirectory(badTag)).rejects.toThrow(/Invalid editorial tags/)
    const none = writeCatalog({ 'readme.txt': 'nope' })
    paths.push(none)
    await expect(loadCatalogDirectory(none)).rejects.toThrow(/No catalog JSON/)
    const wrapped = writeCatalog({ 'nav.json': [sampleMessages()[0]] })
    paths.push(wrapped)
    writeFileSync(
      join(wrapped, 'nav.json'),
      `${JSON.stringify({ messages: [sampleMessages()[0]] })}\n`,
    )
    await expect(loadCatalogDirectory(wrapped)).rejects.toThrow(/one message per line/)
  })
})

function compilePath(directory: string, messages: ReturnType<typeof sampleMessages>): string {
  const output = join(directory, 'ok.sqlite')
  compileLocalizationSqlite(messages, output)
  return output
}
