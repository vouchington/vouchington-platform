import { stripLeadingSqlComments } from './strip-leading-sql-comments.mts'
import { splitSqlStatements } from './sql-statements.mts'

type MigrationMode = 'online' | 'transactional'

export interface PreparedMigration {
  mode: MigrationMode
  statements: readonly string[]
}

const migrationModeDirective = /^\s*--\s*migration-mode:\s*(\S+)\s*$/gim
const transactionControlStatement = /^(?:BEGIN|START\s+TRANSACTION|COMMIT|ROLLBACK)\b/i
const concurrentIndexStatement =
  /^(?:CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY|DROP\s+INDEX\s+CONCURRENTLY)\b/i
const replaySafeCreateIndexStatement =
  /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\s+IF\s+NOT\s+EXISTS\b/i
const replaySafeDropIndexStatement = /^DROP\s+INDEX\s+CONCURRENTLY\s+IF\s+EXISTS\b/i

export function prepareMigration(sql: string): PreparedMigration {
  const mode = extractMigrationMode(sql)
  const splitStatements = splitSqlStatements(sql)
  const executableStatements = splitStatements.map(stripLeadingSqlComments)

  if (executableStatements.some((statement) => transactionControlStatement.test(statement))) {
    throw new Error('Managed migrations must not contain transaction control statements')
  }

  if (mode === 'online') {
    assertReplaySafeOnlineStatements(executableStatements)
    return { mode, statements: splitStatements }
  }

  if (executableStatements.some((statement) => concurrentIndexStatement.test(statement))) {
    throw new Error(
      'Concurrent index operations require "-- migration-mode: online" so they run outside a transaction',
    )
  }

  return { mode, statements: [sql] }
}

function extractMigrationMode(sql: string): MigrationMode {
  const directives = [...sql.matchAll(migrationModeDirective)]
  if (directives.length > 1) {
    throw new Error('Migration SQL must contain at most one migration-mode directive')
  }

  const value = directives[0]?.[1]?.toLowerCase()
  if (!value) return 'transactional'
  if (value === 'online' || value === 'transactional') return value
  throw new Error(`Unsupported migration mode "${value}"`)
}

function assertReplaySafeOnlineStatements(statements: readonly string[]): void {
  for (const statement of statements) {
    if (
      replaySafeCreateIndexStatement.test(statement) ||
      replaySafeDropIndexStatement.test(statement)
    ) {
      continue
    }

    if (concurrentIndexStatement.test(statement)) {
      throw new Error(
        'Online concurrent index operations must be replay-safe with IF NOT EXISTS or IF EXISTS',
      )
    }

    throw new Error('Online migration mode only supports concurrent index operations')
  }
}
