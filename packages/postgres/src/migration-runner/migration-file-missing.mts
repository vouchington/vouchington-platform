export class MigrationFileMissingError extends Error {
  readonly migration: string

  constructor(migration: string) {
    super(`Migration "${migration}" was already applied but its file is no longer on disk.`)
    this.name = 'MigrationFileMissingError'
    this.migration = migration
  }
}
