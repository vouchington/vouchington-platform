import type pg from 'pg'

import { connectWithRetry } from './connect-with-retry.mts'
import {
  runBoundedTransactionWithClient,
  type BoundedTransactionOptions,
} from './bounded-transaction.mts'
import type { PsqlRuntime, TransactionQuery } from './types.mts'

export type { BoundedTransactionOptions }

export function createBoundedTransactionApi(runtime: PsqlRuntime) {
  return async function withBoundedTransaction<Result>(
    options: BoundedTransactionOptions,
    handler: (query: TransactionQuery) => Promise<Result>,
  ): Promise<Result> {
    const client = await acquireClientWithin(runtime.pools.write, options.connectionTimeoutMs)
    return runBoundedTransactionWithClient(options, client, handler, runtime)
  }
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
