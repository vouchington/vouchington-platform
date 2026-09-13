import { mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  canonicalJson,
  catalogFromMessages,
  compareCodePoints,
  LOCALIZATION_WIRE_CONTRACT,
  type LocalizationCatalog,
  type CatalogMessage,
} from '@vouchington/localization'
import type { EditorialTags } from './load.mts'
import { assertSqliteIntegrity } from './integrity.mts'
import { catalogRevision } from './revision.mts'
import { SQLITE_SCHEMA } from './schema.mts'
import { validateCatalogMessages } from './validate.mts'
import { sortedCatalog } from './catalog.mts'

export function compileLocalizationSqlite(
  source: LocalizationCatalog | readonly CatalogMessage[],
  outputPath: string,
  tags: EditorialTags = {},
): string {
  const catalog = isCatalog(source) ? source : { ...catalogFromMessages(source), tags }
  if (!isCatalog(source)) validateCatalogMessages(source)
  const normalized = sortedCatalog(catalog)
  const revision = catalogRevision(normalized)
  mkdirSync(dirname(outputPath), { recursive: true })
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'localization-'))
  const temporary = join(temporaryDirectory, 'catalog.sqlite')
  const database = new DatabaseSync(temporary)
  try {
    try {
      database.exec('PRAGMA foreign_keys = ON')
      database.exec('BEGIN')
      try {
        database.exec(SQLITE_SCHEMA)
        insertMetadata(database, revision)
        insertCatalog(database, normalized)
        assertSqliteIntegrity(database)
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
    } finally {
      database.close()
    }
    renameSync(temporary, outputPath)
    return revision
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true })
  }
}

function isCatalog(
  source: LocalizationCatalog | readonly CatalogMessage[],
): source is LocalizationCatalog {
  return !Array.isArray(source) || Object.hasOwn(source, 'copies')
}

function insertMetadata(database: DatabaseSync, revision: string): void {
  const insert = database.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)')
  insert.run('contract', LOCALIZATION_WIRE_CONTRACT)
  insert.run('revision', revision)
}

function insertCatalog(database: DatabaseSync, catalog: LocalizationCatalog): void {
  const insertCopy = database.prepare('INSERT INTO copies (id, descriptor_json) VALUES (?, ?)')
  const insertTranslation = database.prepare(
    'INSERT INTO translations (locale, copy_id, value_json) VALUES (?, ?, ?)',
  )
  const insertAlias = database.prepare(
    'INSERT INTO consumer_aliases (consumer, alias, copy_id) VALUES (?, ?, ?)',
  )
  const insertRoute = database.prepare(
    'INSERT INTO route_membership (consumer, selector_id, alias) VALUES (?, ?, ?)',
  )
  const insertTag = database.prepare('INSERT INTO editorial_tags (copy_id, tag) VALUES (?, ?)')
  for (const copy of catalog.copies) insertCopy.run(copy.id, canonicalJson(copy.descriptor))
  for (const alias of catalog.aliases) insertAlias.run(alias.consumer, alias.alias, alias.copyId)
  for (const route of catalog.routeMembership!)
    insertRoute.run(route.consumer, route.selectorId, route.alias)
  for (const [locale, rows] of Object.entries(catalog.translations)) {
    for (const row of rows) insertTranslation.run(locale, row.id, canonicalJson(row.value))
  }
  for (const id of Object.keys(catalog.tags!).toSorted(compareCodePoints))
    for (const tag of catalog.tags![id]!) insertTag.run(id, tag)
}
