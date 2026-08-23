export type MigrationLogger = {
  error: typeof console.error
  log: typeof console.log
}

export const silentMigrationLogger: MigrationLogger = {
  error: () => {},
  log: () => {},
}
