import type pg from 'pg'

import type { Transaction } from './create-psql-types.mts'
import { getTransactionCleanupOutcome, rollbackFailedCommit } from './transaction-cleanup.mts'
import { beginTransactionSession, runQueuedTransactionHandler } from './transaction-session.mts'
import { beginOwnedPoolTransaction, beginTransactionResource } from './transaction-resource.mts'
import { isInTransaction } from './transaction-probe.mts'
import type {
  BeginTransactionOptions,
  PsqlRuntime,
  QueryOptions,
  TransactionQuery,
} from './types.mts'

export function createTransactionApi(runtime: PsqlRuntime) {
  const beginTransaction = (options: BeginTransactionOptions = {}): Promise<Transaction> =>
    beginTransactionResource(runtime, options, '/* beginTransaction */')
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
async function withOwnedTransaction<Result>(
  runtime: PsqlRuntime,
  handler: (query: TransactionQuery) => Promise<Result>,
  annotation: string,
): Promise<Result> {
  return runTransactionHandler(
    await beginOwnedPoolTransaction(runtime, runtime.pools.write, annotation),
    handler,
  )
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
  return runTransactionHandler(
    await beginOwnedPoolTransaction(runtime, pool, '/* withClientTransaction */', {
      queryPool: getPoolLabel(runtime, pool),
    }),
    handler,
  )
}

async function withBorrowedTransaction<Result>(
  runtime: PsqlRuntime,
  client: pg.PoolClient,
  handler: (query: TransactionQuery) => Promise<Result>,
): Promise<Result> {
  if (await isInTransaction(client))
    return runQueuedTransactionHandler(runtime, client, handler, 'client')
  const transaction = await beginTransactionSession(runtime, client, {
    annotation: '/* withClientTransaction */',
    releaseClient: false,
  })
  try {
    return await runTransactionHandler(transaction, handler)
  } catch (error) {
    try {
      await rollbackFailedCommit(transaction)
    } catch (rollback) {
      reportBorrowedRollbackFailure(runtime, error, rollback)
    }
    throw error
  }
}

function reportBorrowedRollbackFailure(
  runtime: PsqlRuntime,
  primary: unknown,
  rollback: unknown,
): void {
  try {
    runtime.errorHandler(
      new AggregateError(
        [primary, rollback],
        'PostgreSQL borrowed transaction commit failed and rollback did not complete',
        { cause: primary },
      ),
    )
  } catch {
    // Cleanup reporting must not replace the commit failure.
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

function getPoolLabel(runtime: PsqlRuntime, pool: pg.Pool): 'client' | 'read' | 'write' {
  if (pool === runtime.pools.read) return 'read'
  if (pool === runtime.pools.write) return 'write'
  return 'client'
}
