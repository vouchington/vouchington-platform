import type pg from 'pg'

import { connectWithRetry } from './connect-with-retry.mts'
import { executeClientQuery } from './execute-client-query.mts'
import type {
  PsqlRuntime,
  QueryInput,
  QueryOptions,
  QueryValues,
  TransactionQuery,
} from './types.mts'
import type { Transaction } from './create-psql-types.mts'

const TRANSACTION_PROBE_SAVEPOINT = 'vouchington_transaction_probe'

export function createTransactionApi(runtime: PsqlRuntime) {
  async function beginTransaction(): Promise<Transaction> {
    const client = await connectWithRetry(runtime.pools.write)
    return beginClientTransaction(runtime, client)
  }
  async function withTransaction<Result>(
    handler: (query: TransactionQuery) => Promise<Result>,
  ): Promise<Result> {
    const client = await connectWithRetry(runtime.pools.write)
    try {
      return await withClientTransaction(runtime, client, handler)
    } finally {
      client.release()
    }
  }

  function withTransactionOptions<Result>(
    options: QueryOptions,
    handler: (query: TransactionQuery) => Promise<Result>,
  ): Promise<Result> {
    if (isTransactionQuery(options.query)) return handler(options.query)
    if (isPoolClient(options.client)) return withClientTransaction(runtime, options.client, handler)
    if (isPool(options.client)) return withPoolTransaction(runtime, options.client, handler)
    return withTransaction(handler)
  }

  return { beginTransaction, withTransaction, withTransactionOptions }
}

export async function beginClientTransaction(runtime: PsqlRuntime, client: pg.PoolClient): Promise<Transaction> {
  await executeClientQuery(client, '/* beginTransaction */ BEGIN', undefined, 'client', {
    env: runtime.env,
    onQueryTiming: runtime.onQueryTiming,
  })
  const queued = createQueuedTransactionQuery(runtime, client)
  let settled: 'committed' | 'rolled_back' | undefined
  let settling = false
  let released = false
  const release = (destroy = false) => {
    if (!released) client.release(destroy)
    released = true
  }
  const settle = async (operation: 'COMMIT' | 'ROLLBACK'): Promise<void> => {
    if (settled === (operation === 'COMMIT' ? 'committed' : 'rolled_back')) return
    if (settled || settling) throw new Error('Transaction is already settled')
    settling = true
    try {
      await queued.awaitQueue()
      if (operation === 'COMMIT') queued.throwIfFailed()
      await executeClientQuery(client, `/* beginTransaction */ ${operation}`, undefined, 'client', {
        env: runtime.env,
        onQueryTiming: runtime.onQueryTiming,
      })
      settled = operation === 'COMMIT' ? 'committed' : 'rolled_back'
    } catch (error) {
      if (operation === 'COMMIT') {
        try {
          await executeClientQuery(client, '/* beginTransaction */ ROLLBACK', undefined, 'client', {
            env: runtime.env,
            onQueryTiming: runtime.onQueryTiming,
          })
        } catch {}
      }
      settled = 'rolled_back'
      release(true)
      throw error
    } finally {
      settling = false
      if (settled && !released) release()
    }
  }
  const query = Object.assign(
    ((input: QueryInput, values?: QueryValues) => {
      if (settled || settling) return Promise.reject(new Error('Transaction is already settled'))
      return queued.query(input, values)
    }) as TransactionQuery,
    {
      client,
      commit: () => settle('COMMIT'),
      rollback: () => settle('ROLLBACK'),
      [Symbol.asyncDispose]: async () => {
        if (!settled) await settle('ROLLBACK')
      },
    },
  ) as Transaction
  return query
}

async function withPoolTransaction<Result>(
  runtime: PsqlRuntime,
  pool: pg.Pool,
  handler: (query: TransactionQuery) => Promise<Result>,
): Promise<Result> {
  const client = await connectWithRetry(pool)
  try {
    return await withClientTransaction(runtime, client, handler)
  } finally {
    client.release()
  }
}

async function withClientTransaction<Result>(
  runtime: PsqlRuntime,
  client: pg.PoolClient,
  handler: (query: TransactionQuery) => Promise<Result>,
): Promise<Result> {
  const alreadyInTransaction = await isInTransaction(client)
  let transactionStarted = false
  const { query, awaitQueue, throwIfFailed } = createQueuedTransactionQuery(runtime, client)

  try {
    if (!alreadyInTransaction) {
      await executeClientQuery(client, '/* withClientTransaction */ BEGIN', undefined, 'client', {
        env: runtime.env,
        onQueryTiming: runtime.onQueryTiming,
      })
      transactionStarted = true
    }

    const result = await handler(query)
    await awaitQueue()
    throwIfFailed()

    if (transactionStarted) {
      await executeClientQuery(client, '/* withClientTransaction */ COMMIT', undefined, 'client', {
        env: runtime.env,
        onQueryTiming: runtime.onQueryTiming,
      })
    }

    return result
  } catch (error) {
    await awaitQueue()
    if (transactionStarted) {
      try {
        await executeClientQuery(
          client,
          '/* withClientTransaction */ ROLLBACK',
          undefined,
          'client',
          { env: runtime.env, onQueryTiming: runtime.onQueryTiming },
        )
      } catch {
        // Ignore rollback errors so the original failure is preserved.
      }
    }
    throw error
  }
}

function createQueuedTransactionQuery(runtime: PsqlRuntime, client: pg.PoolClient) {
  let transactionFailed: unknown
  let queue = Promise.resolve()

  function runTransactionQuery<Row extends pg.QueryResultRow = pg.QueryResultRow>(
    input: QueryInput,
    values?: QueryValues,
  ): Promise<pg.QueryResult<Row>> {
    const result = queue.then(async () => {
      if (transactionFailed) throwTransactionFailure(transactionFailed)
      try {
        return await executeClientQuery<Row>(client, input, values, 'write', {
          env: runtime.env,
          onQueryTiming: runtime.onQueryTiming,
        })
      } catch (error) {
        transactionFailed = error
        throw error
      }
    })
    queue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  return {
    query: Object.assign(runTransactionQuery, { client }) as TransactionQuery,
    awaitQueue: () => queue,
    throwIfFailed: () => {
      if (transactionFailed) throwTransactionFailure(transactionFailed)
    },
  }
}

function throwTransactionFailure(error: unknown): never {
  if (error instanceof Error) throw error
  throw new Error(`Transaction failed: ${String(error)}`)
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
