import type pg from 'pg'

import { connectWithRetry } from './connect-with-retry.mts'
import type { BoundedTransactionOptions } from './bounded-transaction.mts'
import type { Transaction } from './create-psql-types.mts'
import { beginOwnedTransaction, runTransactionHandler } from './transactions.mts'
import type { PsqlRuntime, TransactionQuery } from './types.mts'

export type { BoundedTransactionOptions } from './bounded-transaction.mts'

export function createBoundedTransactionApi(runtime: PsqlRuntime) {
  const beginBoundedTransaction = async (
    options: BoundedTransactionOptions,
  ): Promise<Transaction> =>
    beginOwnedTransaction(
      runtime,
      await acquireClientWithin(runtime.pools.write, options.connectionTimeoutMs),
      '/* beginBoundedTransaction */',
      options.statementTimeoutMs,
    )
  const withBoundedTransaction = async <Result,>(
    options: BoundedTransactionOptions,
    handler: (query: TransactionQuery) => Promise<Result>,
  ): Promise<Result> => runTransactionHandler(await beginBoundedTransaction(options), handler)
  return { beginBoundedTransaction, withBoundedTransaction }
}

async function acquireClientWithin(pool: pg.Pool, timeoutMs: number): Promise<pg.PoolClient> {
  const pendingClient = connectWithRetry(pool)
  let rejectTimeout!: (error: Error) => void
  const timeout = new Promise<never>((_resolve, reject) => {
    rejectTimeout = reject
  })
  const timer = setTimeout(
    () =>
      rejectTimeout(new Error(`PostgreSQL connection acquisition timed out after ${timeoutMs}ms`)),
    timeoutMs,
  )
  timer.unref()
  try {
    return await Promise.race([pendingClient, timeout])
  } catch (error) {
    void pendingClient.then(
      (client) => client.release(),
      () => undefined,
    )
    throw error
  } finally {
    clearTimeout(timer)
  }
}
