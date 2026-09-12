import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  canonicalJson,
  compareCodePoints,
  LOCALIZATION_WIRE_CONTRACT,
  serializeCatalogShard,
  type CatalogMessage,
} from '@vouchington/localization'
import type { EditorialTags } from './load.mts'
import { assertSqliteIntegrity } from './integrity.mts'
import { catalogRevision } from './revision.mts'
import { SQLITE_SCHEMA } from './schema.mts'
import { validateCatalogMessages } from './validate.mts'

export function compileLocalizationSqlite(
  messages: readonly CatalogMessage[],
  outputPath: string,
  tags: EditorialTags = {},
): string {
  validateCatalogMessages(messages)
  const revision = catalogRevision(messages)
  mkdirSync(dirname(outputPath), { recursive: true })
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'localization-'))
  const temporary = join(temporaryDirectory, 'catalog.sqlite')
  const database = new DatabaseSync(temporary)
  try {
    database.exec('PRAGMA journal_mode = OFF')
    database.exec(SQLITE_SCHEMA)
    insertMetadata(database, revision)
    insertMessages(database, messages)
    insertTags(database, tags)
    database.exec('PRAGMA foreign_keys = ON')
    assertSqliteIntegrity(database)
  } finally {
    database.close()
  }
  renameSync(temporary, outputPath)
  rmSync(temporaryDirectory, { recursive: true, force: true })
  return revision
}

export function writeJsonCatalog(messages: readonly CatalogMessage[], path: string): void {
  writeFileSync(path, serializeCatalogShard(messages))
}

function insertMetadata(database: DatabaseSync, revision: string): void {
  const insert = database.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)')
  insert.run('contract', LOCALIZATION_WIRE_CONTRACT)
  insert.run('revision', revision)
}

function insertMessages(database: DatabaseSync, messages: readonly CatalogMessage[]): void {
  const insertMessage = database.prepare('INSERT INTO messages (id, descriptor_json) VALUES (?, ?)')
  const insertTranslation = database.prepare(
    'INSERT INTO translations (locale, message_id, value_json) VALUES (?, ?, ?)',
  )
  const insertConsumer = database.prepare(
    'INSERT INTO consumer_membership (consumer, message_id) VALUES (?, ?)',
  )
  for (const message of [...messages].toSorted((left, right) =>
    compareCodePoints(left.id, right.id),
  )) {
    insertMessage.run(message.id, canonicalJson(message.descriptor))
    for (const consumer of message.consumers) insertConsumer.run(consumer, message.id)
    for (const locale of Object.keys(message.translations).toSorted(compareCodePoints)) {
      insertTranslation.run(locale, message.id, canonicalJson(message.translations[locale]))
    }
  }
}

function insertTags(database: DatabaseSync, tags: EditorialTags): void {
  const insert = database.prepare('INSERT INTO editorial_tags (message_id, tag) VALUES (?, ?)')
  for (const id of Object.keys(tags).toSorted(compareCodePoints)) {
    for (const tag of tags[id]!) insert.run(id, tag)
  }
}
