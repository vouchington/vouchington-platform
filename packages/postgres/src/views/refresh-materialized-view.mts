import type pg from 'pg'

import { assertWhitelistedSqlIdentifier } from '../sql-fragments.mts'

export interface RefreshMaterializedViewOptions {
  /** Pool to take a dedicated session from; the advisory lock is session-scoped. */
  pool: pg.Pool
  viewName: string
  /** `REFRESH` cannot bind identifiers, so the name must be in this injected allowlist. */
  allowedViews: ReadonlySet<string> | readonly string[]
  /** Serializes refreshes across processes. Defaults to the shared `refresh-materialized-view` key. */
  advisoryLockKey?: string
  /** Receives the unlock failure when a refresh failure takes precedence. */
  reportError?: (error: Error) => void
}

const DEFAULT_ADVISORY_LOCK_KEY = 'refresh-materialized-view'

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

/**
 * `REFRESH MATERIALIZED VIEW CONCURRENTLY` under a session advisory lock. Contention rejects with
 * a retryable error rather than queueing. A connection whose lock could not be released is
 * destroyed. The view needs a unique index for `CONCURRENTLY`.
 */
export async function refreshMaterializedView(
  options: RefreshMaterializedViewOptions,
): Promise<void> {
  const { pool, advisoryLockKey = DEFAULT_ADVISORY_LOCK_KEY } = options
  const viewName = assertWhitelistedSqlIdentifier(
    options.viewName,
    options.allowedViews,
    'materialized view',
  )
  const client = await pool.connect()
  let released = false
  try {
    const lock = await client.query<{ locked: boolean }>(
      '/* refreshMaterializedView.tryAdvisoryLock */ SELECT pg_try_advisory_lock(hashtext($1)) AS locked',
      [advisoryLockKey],
    )
    if (!lock.rows[0]?.locked) {
      client.release()
      released = true
      throw new Error('Materialized view refresh contention; retryable')
    }
    let refreshError: Error | undefined
    try {
      await client.query(
        `/* refreshMaterializedView */ REFRESH MATERIALIZED VIEW CONCURRENTLY ${viewName}`,
      )
    } catch (err) {
      refreshError = toError(err)
    }
    const unlockError = await unlock(client, advisoryLockKey)
    client.release(unlockError)
    released = true
    if (unlockError && refreshError) options.reportError?.(unlockError)
    if (refreshError ?? unlockError) throw refreshError ?? unlockError
  } catch (err) {
    if (!released) client.release(toError(err))
    throw toError(err)
  }
}

async function unlock(client: pg.PoolClient, key: string): Promise<Error | undefined> {
  try {
    const result = await client.query<{ unlocked: boolean }>(
      '/* refreshMaterializedView.unlock */ SELECT pg_advisory_unlock(hashtext($1)) AS unlocked',
      [key],
    )
    return result.rows[0]?.unlocked
      ? undefined
      : new Error('Materialized view advisory lock was not held at release')
  } catch (err) {
    return toError(err)
  }
}
