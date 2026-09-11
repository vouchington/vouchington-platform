import { DatabaseSync } from 'node:sqlite'
import { LOCALIZATION_WIRE_CONTRACT } from '@vouchington/localization'
import { assertSqliteIntegrity } from './integrity.mts'
import { DEFAULT_SQLITE_CACHE_KB } from './schema.mts'

export type LocalizationDatabase = {
  readonly revision: string
  readonly contract: string
  readonly sqlite: DatabaseSync
  close(): void
}

export function openLocalizationDatabase(
  path: string,
  options: { cacheKb?: number } = {},
): LocalizationDatabase {
  const sqlite = new DatabaseSync(path, { readOnly: true })
  sqlite.exec('PRAGMA query_only = ON')
  sqlite.exec(`PRAGMA cache_size = -${options.cacheKb ?? DEFAULT_SQLITE_CACHE_KB}`)
  sqlite.exec('PRAGMA mmap_size = 0')
  assertSqliteIntegrity(sqlite)
  const contract = readMetadata(sqlite, 'contract')
  const revision = readMetadata(sqlite, 'revision')
  if (contract !== LOCALIZATION_WIRE_CONTRACT) {
    sqlite.close()
    throw new Error(`Unsupported localization contract "${contract}"`)
  }
  return {
    revision,
    contract,
    sqlite,
    close() {
      sqlite.close()
    },
  }
}

function readMetadata(database: DatabaseSync, key: string): string {
  const row = database.prepare('SELECT value FROM metadata WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  if (row === undefined) {
    database.close()
    throw new Error(`Localization artifact is missing metadata "${key}"`)
  }
  return row.value
}
