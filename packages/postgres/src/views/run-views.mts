import { getFilesFromFolder, readMigrationFile } from '../migration-runner/files.mts'
import { splitSqlStatements } from '../migration-runner/sql-statements.mts'
import type { QueryExecutor } from '../types.mts'
import { extractViewDeclarations, uniqueViewDeclarations } from './declarations.mts'
import { buildDropViewsStatement } from './drop.mts'

export type ViewLogger = { error: typeof console.error; log: typeof console.log }

export interface RunViewsOptions {
  /** Folder of `.sql` view files, applied in name order and retried until dependencies resolve. */
  folder: string
  /** Executes each statement. Callers choose the pool or transaction. */
  writer: QueryExecutor
  /**
   * Runs one file's statements atomically (e.g. `psql.withTransaction`), so a retried file never
   * re-runs statements that already committed. Defaults to running directly on `writer`.
   */
  withTransaction?: <Result>(handler: (writer: QueryExecutor) => Promise<Result>) => Promise<Result>
  /** Retry files that fail until a pass makes no progress. Set false to fail on first error. */
  retryBlocked?: boolean
  /** Drop every declared view first, dependents before dependencies. */
  forced?: boolean
  /** Defaults to silent. */
  logger?: ViewLogger
}

type PendingView = { view: string; sql: string }
type Attempt = { pending: PendingView; success: boolean }

const silentLogger: ViewLogger = { error: () => {}, log: () => {} }

/**
 * Applies view files (`CREATE OR REPLACE VIEW`, materialized views, indexes) in repeated passes.
 * A file that fails because it depends on a view not yet created is retried after the others;
 * a pass that makes no progress throws the last error, naming the blocked files. Requires
 * `loadSqlParserModule()` to have resolved.
 */
export async function runViews(options: RunViewsOptions): Promise<void> {
  const { folder, writer, logger = silentLogger, retryBlocked = true } = options
  const inTransaction = options.withTransaction ?? ((handler) => handler(writer))
  const files = getFilesFromFolder(folder, ['.sql'])
  let pending: PendingView[] = await Promise.all(
    files.map(async (view) => ({ view, sql: await readMigrationFile(folder, view) })),
  )

  if (options.forced) {
    const declarations = uniqueViewDeclarations(
      pending.flatMap((file) => extractViewDeclarations(file.sql)),
    )
    const dropStatement = buildDropViewsStatement(declarations)
    if (dropStatement) {
      await writer(dropStatement)
      logger.log('Forced view rebuild: dropped %d views before recreation', declarations.length)
    }
  }

  let lastError: unknown = null
  const attempt = async (view: PendingView): Promise<Attempt> => {
    try {
      await inTransaction((target) => runViewStatements(target, view.sql))
      logger.log('View %s updated!', view.view)
      return { pending: view, success: true }
    } catch (err) {
      lastError = err
      return { pending: view, success: false }
    }
  }

  while (pending.length > 0) {
    const attempts: Attempt[] = []
    let halted = false
    // Sequential: a view may depend on one created earlier in the same pass.
    await pending.reduce(
      (previous, view) =>
        previous.then(async () => {
          if (halted) return
          const result = await attempt(view)
          attempts.push(result)
          halted = !result.success && !retryBlocked
        }),
      Promise.resolve(),
    )
    const remaining = attempts.flatMap((result) => (result.success ? [] : [result.pending]))
    if (remaining.length > 0 && (!retryBlocked || remaining.length === attempts.length)) {
      throwBlockedViews(remaining, lastError, logger)
    }
    pending = remaining
  }
}

async function runViewStatements(writer: QueryExecutor, sql: string): Promise<void> {
  await splitSqlStatements(sql).reduce(
    (previous, statement) =>
      previous.then(async () => {
        await writer(`/* runViews */ ${statement}`)
      }),
    Promise.resolve(),
  )
}

function throwBlockedViews(blocked: PendingView[], lastError: unknown, logger: ViewLogger): never {
  const names = blocked.map((view) => view.view).join(', ')
  logger.error('ERROR: view recreation made no progress; blocked views: %s', names)
  logger.error(lastError)
  if (lastError instanceof Error) {
    throw new Error(`${lastError.message}\nBlocked views: ${names}`, { cause: lastError })
  }
  throw new Error(`View recreation made no progress for: ${names}`)
}
