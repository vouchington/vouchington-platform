import { runConfigDrivenStatementsInTransaction } from './config-driven-statements.mts'
import type { ConfigDrivenTarget } from './config-driven-statements.mts'
import { getFilesFromFolder, readMigrationFile } from './files.mts'
import { silentMigrationLogger, type MigrationLogger } from './migration-logger.mts'

export interface RunConfigDrivenOptions {
  target: ConfigDrivenTarget
  logger?: MigrationLogger
  /** Defaults to 5 seconds. */
  lockTimeoutMs?: number
  /** Total attempts per file on deadlock or lock timeout. Defaults to 3. */
  maxAttempts?: number
  /** Waits before retry `attempt + 1`. Defaults to a jittered, capped linear backoff. */
  waitForRetry?: (attempt: number) => Promise<void>
  /** Resolves a file's SQL. Defaults to `readMigrationFile`; inject for bundled generators. */
  readFile?: (folder: string, file: string) => Promise<string>
  reportError?: (error: Error) => void
}

const DEADLOCK_SQLSTATE = '40P01'
const LOCK_TIMEOUT_SQLSTATE = '55P03'
const RETRY_DELAY_MS = 1000
const MAX_RETRY_DELAY_MS = 5000

function isRetryable(error: unknown): error is { code: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === DEADLOCK_SQLSTATE || error.code === LOCK_TIMEOUT_SQLSTATE)
  )
}

function defaultWaitForRetry(attempt: number): Promise<void> {
  const delay = Math.min(RETRY_DELAY_MS * (attempt + Math.random()), MAX_RETRY_DELAY_MS)
  return new Promise((resolve) => setTimeout(resolve, delay))
}

/**
 * Runs the `.sql` and `.mts` files of `folder` in filename order, each through
 * `runConfigDrivenStatementsInTransaction`. A file that hits a deadlock or lock timeout is replayed
 * whole, so config-driven SQL must be idempotent. Requires `loadSqlParserModule()`.
 */
export async function runConfigDriven(
  folder: string,
  options: RunConfigDrivenOptions,
): Promise<void> {
  const logger = options.logger ?? silentMigrationLogger
  const maxAttempts = options.maxAttempts ?? 3
  const waitForRetry = options.waitForRetry ?? defaultWaitForRetry
  const readFile = options.readFile ?? readMigrationFile

  for (const file of getFilesFromFolder(folder)) {
    const sql = await readFile(folder, file)
    for (let attempt = 1; ; attempt++) {
      try {
        await runConfigDrivenStatementsInTransaction(sql, options.target, options)
        logger.log('Config-driven migration %s complete!', file)
        break
      } catch (error) {
        if (isRetryable(error) && attempt < maxAttempts) {
          logger.log(
            'Config-driven migration %s hit PostgreSQL lock contention (%s); retrying attempt %d of %d.',
            file,
            error.code,
            attempt + 1,
            maxAttempts,
          )
          await waitForRetry(attempt)
          continue
        }
        logger.error('ERROR: running config-driven migration %s failed!', file)
        logger.error(sql)
        logger.error('ERROR: running config-driven migration %s failed after SQL dump!', file)
        throw error
      }
    }
  }
}
