import type { QueryExecutor } from '../types.mts'
import { splitSqlStatements } from './sql-statements.mts'

/** Where config-driven statements run: a caller-held session, or a fresh transaction per group. */
export type ConfigDrivenTarget =
  | { writer: QueryExecutor; beginTransaction?: undefined }
  | {
      writer?: undefined
      beginTransaction: () => Promise<
        QueryExecutor & {
          commit: () => Promise<void>
          [Symbol.asyncDispose]: () => PromiseLike<void>
        }
      >
    }

export interface ConfigDrivenStatementsOptions {
  /** Defaults to 5 seconds; applied as `SET LOCAL lock_timeout` in every group. */
  lockTimeoutMs?: number
  /** Receives a failed `ROLLBACK` on a caller-held session; the original error is rethrown. */
  reportError?: (error: Error) => void
}

const DEFAULT_LOCK_TIMEOUT_MS = 5_000
const ANNOTATION = '/* runConfigDrivenStatementsInTransaction */'

const isConstraintValidation = (statement: string) => /\bVALIDATE\s+CONSTRAINT\b/i.test(statement)

/**
 * Runs each statement of `sql` in a transaction with a local lock timeout. `VALIDATE CONSTRAINT`
 * statements get a transaction of their own so their long scans never hold earlier DDL locks.
 * Requires `loadSqlParserModule()` to have resolved.
 */
export async function runConfigDrivenStatementsInTransaction(
  sql: string,
  target: ConfigDrivenTarget,
  options: ConfigDrivenStatementsOptions = {},
): Promise<void> {
  const lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS
  const lockTimeout = `${ANNOTATION} SET LOCAL lock_timeout = '${Math.round(lockTimeoutMs)}ms'`
  const runGroup = async (group: readonly string[]) => {
    if (group.length === 0) return
    if (target.writer) {
      await runOnWriter(target.writer, lockTimeout, group, options.reportError)
      return
    }
    await using transaction = await target.beginTransaction()
    await transaction(lockTimeout)
    for (const statement of group) await transaction(`/* runConfigDrivenStatements */ ${statement}`)
    await transaction.commit()
  }

  let group: string[] = []
  for (const statement of splitSqlStatements(sql)) {
    if (!isConstraintValidation(statement)) {
      group.push(statement)
      continue
    }
    await runGroup(group)
    group = []
    await runGroup([statement])
  }
  await runGroup(group)
}

async function runOnWriter(
  writer: QueryExecutor,
  lockTimeout: string,
  statements: readonly string[],
  reportError: ((error: Error) => void) | undefined,
): Promise<void> {
  await writer(`${ANNOTATION} BEGIN`)
  try {
    await writer(lockTimeout)
    for (const statement of statements) await writer(`/* runConfigDrivenStatements */ ${statement}`)
    await writer(`${ANNOTATION} COMMIT`)
  } catch (error) {
    await writer(`${ANNOTATION} ROLLBACK`).catch((rollbackError: unknown) => {
      reportError?.(
        rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError)),
      )
    })
    throw error
  }
}
