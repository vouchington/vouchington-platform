import type pg from 'pg'

import { connectWithRetry } from './connect-with-retry.mts'
import { executeClientQuery } from './execute-client-query.mts'
import type { Transaction } from './create-psql-types.mts'
import { beginTransactionSession, getTransactionCleanupOutcome } from './transaction-session.mts'
import type {
  PsqlRuntime,
  QueryInput,
  QueryOptions,
  QueryValues,
  TransactionQuery,
} from './types.mts'

const TRANSACTION_PROBE_SAVEPOINT = 'vouchington_transaction_probe'
export function createTransactionApi(runtime: PsqlRuntime) {
  const beginTransaction = async (): Promise<Transaction> =>
    beginOwnedTransaction(
      runtime,
      await connectWithRetry(runtime.pools.write),
      '/* beginTransaction */',
    )
  const withTransaction = <Result,>(handler: (query: TransactionQuery) => Promise<Result>) =>
    withOwnedTransaction(runtime, handler, '/* withClientTransaction */')
  const withTransactionOptions = <Result,>(
    options: QueryOptions,
    handler: (query: TransactionQuery) => Promise<Result>,
  ): Promise<Result> => {
    if (isTransactionQuery(options.query)) return handler(options.query)
    if (isPoolClient(options.client))
      return withBorrowedTransaction(runtime, options.client, handler)
    if (isPool(options.client)) return withPoolTransaction(runtime, options.client, handler)
    return withTransaction(handler)
  }
  return { beginTransaction, withTransaction, withTransactionOptions }
}
export async function beginOwnedTransaction(
  runtime: PsqlRuntime,
  client: pg.PoolClient,
  annotation: string,
  statementTimeoutMs?: number,
): Promise<Transaction> {
  return beginTransactionSession(runtime, client, {
    annotation,
    ...(statementTimeoutMs === undefined ? {} : { statementTimeoutMs }),
  })
}
async function withOwnedTransaction<Result>(
  runtime: PsqlRuntime,
  handler: (query: TransactionQuery) => Promise<Result>,
  annotation: string,
  statementTimeoutMs?: number,
): Promise<Result> {
  const transaction = await beginOwnedTransaction(
    runtime,
    await connectWithRetry(runtime.pools.write),
    annotation,
    statementTimeoutMs,
  )
  return runTransactionHandler(transaction, handler)
}

export async function runTransactionHandler<Result>(
  transaction: Transaction,
  handler: (query: TransactionQuery) => Promise<Result>,
  onRollbackError?: (primary: unknown, rollback: unknown) => void,
): Promise<Result> {
  try {
    const result = await handler(transaction)
    await transaction.commit()
    return result
  } catch (error) {
    const cleanup = getTransactionCleanupOutcome(transaction)
    if (cleanup.kind === 'rolled-back') throw error
    if (cleanup.kind === 'rollback-failed') {
      onRollbackError?.(error, cleanup.error)
      throw error
    }
    if (cleanup.kind === 'control-failed') throw error
    try {
      await transaction.rollback()
    } catch (rollback) {
      // Callback APIs preserve the handler or commit failure as the primary error.
      onRollbackError?.(error, rollback)
    }
    throw error
  }
}

async function withPoolTransaction<Result>(
  runtime: PsqlRuntime,
  pool: pg.Pool,
  handler: (query: TransactionQuery) => Promise<Result>,
): Promise<Result> {
  const client = await connectWithRetry(pool)
  let alreadyInTransaction: boolean
  try {
    alreadyInTransaction = await isInTransaction(client)
  } catch (error) {
    client.release(true)
    throw error
  }
  if (alreadyInTransaction) {
    try {
      return await runQueuedTransactionHandler(runtime, client, handler)
    } finally {
      client.release()
    }
  }
  return runTransactionHandler(
    await beginTransactionSession(runtime, client, { annotation: '/* withClientTransaction */' }),
    handler,
  )
}

async function withBorrowedTransaction<Result>(
  runtime: PsqlRuntime,
  client: pg.PoolClient,
  handler: (query: TransactionQuery) => Promise<Result>,
): Promise<Result> {
  if (await isInTransaction(client)) return runQueuedTransactionHandler(runtime, client, handler)
  const transaction = await beginTransactionSession(runtime, client, {
    annotation: '/* withClientTransaction */',
    releaseClient: false,
  })
  return runTransactionHandler(transaction, handler)
}

async function runQueuedTransactionHandler<Result>(
  runtime: PsqlRuntime,
  client: pg.PoolClient,
  handler: (query: TransactionQuery) => Promise<Result>,
): Promise<Result> {
  let failed: unknown
  let hasFailed = false
  let queue = Promise.resolve()
  const query = Object.assign(
    (<Row extends pg.QueryResultRow = pg.QueryResultRow>(
      input: QueryInput,
      values?: QueryValues,
    ) => {
      const result = queue.then(async () => {
        if (hasFailed) throwFailure(failed)
        try {
          return await executeClientQuery<Row>(client, input, values, 'write', {
            env: runtime.env,
            onQueryTiming: runtime.onQueryTiming,
          })
        } catch (error) {
          failed = error
          hasFailed = true
          throw error
        }
      })
      queue = result.then(
        () => undefined,
        () => undefined,
      )
      return result
    }) as TransactionQuery,
    { client },
  )
  try {
    const result = await handler(query)
    await queue
    if (hasFailed) throwFailure(failed)
    return result
  } finally {
    await queue
  }
}

async function isInTransaction(client: pg.PoolClient): Promise<boolean> {
  try {
    await client.query(`SAVEPOINT ${TRANSACTION_PROBE_SAVEPOINT}`)
    await client.query(`RELEASE SAVEPOINT ${TRANSACTION_PROBE_SAVEPOINT}`)
    return true
  } catch (error) {
    if ((error as { code?: string }).code === '25P01') return false
    throw error
  }
}

function isTransactionQuery(query: QueryOptions['query']): query is TransactionQuery {
  return typeof query === 'function' && 'client' in query
}

function isPoolClient(client: QueryOptions['client']): client is pg.PoolClient {
  return Boolean(client && 'release' in client)
}

function isPool(client: QueryOptions['client']): client is pg.Pool {
  return Boolean(client && 'connect' in client && !('release' in client))
}

function throwFailure(error: unknown): never {
  if (error instanceof Error) throw error
  throw new Error(`Transaction failed: ${String(error)}`)
}
