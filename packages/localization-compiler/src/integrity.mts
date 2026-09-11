import type { DatabaseSync } from 'node:sqlite'

export function assertSqliteIntegrity(database: DatabaseSync): void {
  const row = database.prepare('PRAGMA integrity_check').get() as { integrity_check: string }
  if (row.integrity_check !== 'ok') {
    throw new Error(`SQLite integrity_check failed: ${row.integrity_check}`)
  }
}
