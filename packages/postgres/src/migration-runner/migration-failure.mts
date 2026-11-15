import { inspect } from 'node:util'

import type { MigrationLogger } from './migration-logger.mts'

const ERROR_FIELDS = ['code', 'detail', 'hint', 'position', 'where'] as const

/**
 * Logs a failed migration's name and database error before anything else.
 * Migration SQL can run to thousands of lines, so it is printed only when `dumpSql` is set.
 */
export function logMigrationFailure(
  logger: MigrationLogger,
  migration: string,
  sql: string,
  error: unknown,
  dumpSql: boolean,
): void {
  logger.error('ERROR: running migration %s failed: %s', migration, describeMigrationError(error))
  if (dumpSql) logger.error(sql)
  else logger.error('Set DEBUG_MIGRATIONS=true to print the SQL of migration %s.', migration)
}

/** Formats an error's message and any PostgreSQL error fields it carries. */
export function describeMigrationError(error: unknown): string {
  if (!(error instanceof Error)) return inspect(error)
  const fields = error as Error & Partial<Record<(typeof ERROR_FIELDS)[number], unknown>>
  const lines = [error.message]
  for (const name of ERROR_FIELDS) {
    const value = fields[name]
    if (typeof value === 'string' && value !== '') lines.push(`  ${name}: ${value}`)
  }
  return lines.join('\n')
}
