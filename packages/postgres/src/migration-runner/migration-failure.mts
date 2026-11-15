import { inspect } from 'node:util'

import type { MigrationLogger } from './migration-logger.mts'
import { excerptFailingStatement } from './migration-sql-excerpt.mts'

const ERROR_FIELDS = ['code', 'detail', 'hint', 'position', 'where'] as const

/**
 * SQLSTATE classes raised by the server or connection rather than by the migration's SQL:
 * connection exceptions, insufficient resources, operator intervention (including statement
 * timeouts), system errors, and internal errors.
 */
const ENVIRONMENT_CLASSES = new Set(['08', '53', '57', '58', 'XX'])

/**
 * Logs a failed migration's name and database error first. Migration SQL can run to thousands
 * of lines, so the full SQL is printed only when `dumpSql` is set. Otherwise an error the SQL
 * caused shows only the failing statement, and an environment error shows no SQL at all.
 */
export function logMigrationFailure(
  logger: MigrationLogger,
  migration: string,
  sql: string,
  error: unknown,
  dumpSql: boolean,
): void {
  logger.error('ERROR: running migration %s failed: %s', migration, describeMigrationError(error))
  if (dumpSql) {
    logger.error(sql)
    return
  }

  const sqlState = sqlStateOf(error)
  if (sqlState !== undefined && ENVIRONMENT_CLASSES.has(sqlState.slice(0, 2))) {
    logger.error(
      'SQLSTATE class %s points to the database server or connection, not the SQL of migration %s.',
      sqlState.slice(0, 2),
      migration,
    )
    return
  }

  const excerpt = sqlState === undefined ? undefined : excerptFailingStatement(sql, error as object)
  if (excerpt !== undefined) logger.error('Failing statement in %s:\n%s', migration, excerpt)
  logger.error('Set DEBUG_MIGRATIONS=true to print the full SQL of migration %s.', migration)
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

/** Returns the error's five-character SQLSTATE, ignoring Node error codes like ECONNREFUSED. */
function sqlStateOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const { code } = error as { code?: unknown }
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : undefined
}
