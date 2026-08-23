import { createHash } from 'node:crypto'

export class MigrationChecksumMismatchError extends Error {
  readonly migration: string
  readonly recordedChecksum: string
  readonly fileChecksum: string

  constructor(migration: string, recordedChecksum: string, fileChecksum: string) {
    super(
      `Migration "${migration}" was already applied (recorded checksum ${recordedChecksum}), ` +
        `but the file on disk now hashes to ${fileChecksum}. Restore the historical file bytes ` +
        'and ship a new forward migration instead of editing an applied migration in place.',
    )
    this.name = 'MigrationChecksumMismatchError'
    this.migration = migration
    this.recordedChecksum = recordedChecksum
    this.fileChecksum = fileChecksum
  }
}

export function computeMigrationChecksum(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex')
}

export function assertMigrationChecksumMatches(
  migration: string,
  recordedChecksum: string | null,
  fileChecksum: string,
): void {
  if (recordedChecksum === null) return
  if (recordedChecksum === fileChecksum) return
  throw new MigrationChecksumMismatchError(migration, recordedChecksum, fileChecksum)
}
