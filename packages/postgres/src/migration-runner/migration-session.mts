import type pg from 'pg'

import { connectWithRetry } from '../connect-with-retry.mts'
import type { PsqlRuntime } from '../types.mts'
import {
  getMigrationConnectRetry,
  type MigrationConnectRetry,
  type MigrationTimeouts,
} from './migration-options.mts'
import type { PreparedMigration } from './migration-mode.mts'

const migrationAdvisoryLockNamespace = 1_447_904_065

interface SessionSettings {
  lockTimeout: string
  statementTimeout: string
}

export async function withMigrationRunnerSession<Result>(
  runtime: PsqlRuntime,
  timeouts: MigrationTimeouts,
  handler: (client: pg.PoolClient) => Promise<Result>,
  connectRetry: MigrationConnectRetry = getMigrationConnectRetry(runtime.env),
): Promise<Result> {
  const client = await connectWithRetry(runtime.pools.write, connectRetry)
  let advisoryLockAcquired = false
  let settings: SessionSettings | undefined
  let outcome: { ok: true; value: Result } | { error: unknown; ok: false }

  try {
    settings = await readSessionSettings(client)
    await setSessionTimeouts(client, timeouts)
    await client.query(
      '/* withMigrationRunnerSession */ SELECT pg_advisory_lock(hashtext(current_database()), $1)',
      [migrationAdvisoryLockNamespace],
    )
    advisoryLockAcquired = true
    outcome = { ok: true, value: await handler(client) }
  } catch (error) {
    outcome = { error, ok: false }
  }

  const cleanupError = await cleanupMigrationRunnerSession(client, advisoryLockAcquired, settings)
  if (!outcome.ok) throw outcome.error
  if (cleanupError) throw cleanupError
  return outcome.value
}

export async function executePreparedMigration(
  client: pg.PoolClient,
  migration: string,
  prepared: PreparedMigration,
  checksum: string,
): Promise<void> {
  if (prepared.mode === 'online') {
    await runOnlineStatements(client, prepared.statements)
    await client.query(
      '/* executePreparedMigration */ INSERT INTO migrations (id, checksum) VALUES ($1, $2)',
      [migration, checksum],
    )
    return
  }

  await client.query('BEGIN')
  try {
    await client.query(prepared.statements[0] ?? '')
    await client.query(
      '/* executePreparedMigration */ INSERT INTO migrations (id, checksum) VALUES ($1, $2)',
      [migration, checksum],
    )
    await client.query('COMMIT')
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // Preserve the migration failure when rollback also fails.
    }
    throw error
  }
}

async function runOnlineStatements(
  client: pg.PoolClient,
  statements: readonly string[],
  index = 0,
): Promise<void> {
  const statement = statements[index]
  if (!statement) return
  await client.query(statement)
  await runOnlineStatements(client, statements, index + 1)
}

async function cleanupMigrationRunnerSession(
  client: pg.PoolClient,
  advisoryLockAcquired: boolean,
  settings: SessionSettings | undefined,
): Promise<unknown> {
  let cleanupError: unknown

  if (advisoryLockAcquired) {
    try {
      await client.query(
        '/* withMigrationRunnerSession */ SELECT pg_advisory_unlock(hashtext(current_database()), $1)',
        [migrationAdvisoryLockNamespace],
      )
    } catch (error) {
      cleanupError = error
    }
  }

  if (settings) {
    try {
      await restoreSessionSettings(client, settings)
    } catch (error) {
      cleanupError ??= error
    }
  }

  if (cleanupError) client.release(cleanupError as Error)
  else client.release()
  return cleanupError
}

async function readSessionSettings(client: pg.PoolClient): Promise<SessionSettings> {
  const lockTimeout = await client.query<{ lock_timeout: string }>(
    '/* withMigrationRunnerSession */ SHOW lock_timeout',
  )
  const statementTimeout = await client.query<{ statement_timeout: string }>(
    '/* withMigrationRunnerSession */ SHOW statement_timeout',
  )
  return {
    lockTimeout: lockTimeout.rows[0]?.lock_timeout ?? '0',
    statementTimeout: statementTimeout.rows[0]?.statement_timeout ?? '0',
  }
}

async function setSessionTimeouts(
  client: pg.PoolClient,
  timeouts: MigrationTimeouts,
): Promise<void> {
  await client.query(
    "/* withMigrationRunnerSession */ SELECT set_config('lock_timeout', $1, false)",
    [`${timeouts.lockTimeoutMs}ms`],
  )
  await client.query(
    "/* withMigrationRunnerSession */ SELECT set_config('statement_timeout', $1, false)",
    [`${timeouts.statementTimeoutMs}ms`],
  )
}

async function restoreSessionSettings(
  client: pg.PoolClient,
  settings: SessionSettings,
): Promise<void> {
  await client.query(
    "/* withMigrationRunnerSession */ SELECT set_config('lock_timeout', $1, false)",
    [settings.lockTimeout],
  )
  await client.query(
    "/* withMigrationRunnerSession */ SELECT set_config('statement_timeout', $1, false)",
    [settings.statementTimeout],
  )
}
