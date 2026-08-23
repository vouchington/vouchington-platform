import pg from 'pg'

import { createBoundedTransactionApi } from './bounded-transaction-api.mts'
import { createQueryApi } from './clients.mts'
import { withLibpqCompat } from './connection-string.mts'
import { createCursorApi } from './cursors.mts'
import { createPipelineBatch } from './pipeline-batch.mts'
import { getPsqlPoolConfiguration } from './pool-config.mts'
import { createTransactionApi } from './transactions.mts'
import { installPgTypeParsers } from './type-parsers.mts'
import type { CreatePsqlOptions, Psql } from './create-psql-types.mts'
import { ignoreMissingVectorType, registerPgVectorTypes } from './vector.mts'
import { createMigrationRunner } from './migration-runner/fixed-migrations.mts'
import { resolveMigrationTimeouts } from './migration-runner/migration-options.mts'
import { withMigrationRunnerSession } from './migration-runner/migration-session.mts'

export type { CreatePsqlOptions, Psql } from './create-psql-types.mts'

export async function createPsql(options: CreatePsqlOptions): Promise<Psql> {
  installPgTypeParsers()
  const env = options.env ?? process.env
  const errorHandler = options.errorHandler ?? defaultErrorHandler
  const connectionString = withLibpqCompat(options.connectionString)
  const readConnectionString = withLibpqCompat(
    options.readConnectionString ?? options.connectionString,
  )
  const poolConfiguration = getPsqlPoolConfiguration(env)
  const writePool = new pg.Pool({
    ...poolConfiguration.common,
    connectionString,
    max: poolConfiguration.writeMax,
  })
  const advisoryLockPool = new pg.Pool({
    ...poolConfiguration.common,
    connectionString,
    max: poolConfiguration.advisoryLockMax,
  })
  const readPool = new pg.Pool({
    ...poolConfiguration.common,
    connectionString: readConnectionString,
    max: poolConfiguration.readMax,
  })

  const runtime = {
    pools: { write: writePool, read: readPool, advisoryLock: advisoryLockPool },
    env,
    errorHandler,
    onQueryTiming: options.onQueryTiming,
    onBeforeQuery: options.onBeforeQuery,
    databaseName: options.databaseName,
  }

  if (options.vector) {
    await Promise.all([
      registerPgVectorTypes(connectionString).catch((error) =>
        ignoreMissingVectorType(error, errorHandler),
      ),
      readConnectionString === connectionString
        ? Promise.resolve()
        : registerPgVectorTypes(readConnectionString).catch((error) =>
            ignoreMissingVectorType(error, errorHandler),
          ),
    ])
  }

  let closed = false
  const close = async () => {
    if (closed) return
    closed = true
    await Promise.all([writePool.end(), readPool.end(), advisoryLockPool.end()])
  }
  options.onClose?.(close)

  const queryApi = createQueryApi(runtime)
  const transactionApi = createTransactionApi(runtime)
  const cursorApi = createCursorApi(runtime)

  return {
    writePool,
    readPool,
    advisoryLockPool,
    ...queryApi,
    ...transactionApi,
    withBoundedTransaction: createBoundedTransactionApi(runtime),
    pipelineBatch: createPipelineBatch(runtime),
    ...cursorApi,
    runMigrations: createMigrationRunner(runtime, options.migrationExtensions),
    withMigrationSession: (handler, timeouts) =>
      withMigrationRunnerSession(
        runtime,
        resolveMigrationTimeouts(timeouts ?? {}, runtime.env),
        handler,
      ),
    close,
  }
}

function defaultErrorHandler(error: Error): void {
  console.error(error)
}
