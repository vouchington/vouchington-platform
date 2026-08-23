import type pg from 'pg'

import { executeClientQuery } from './execute-client-query.mts'
import type {
  ErrorHandler,
  PsqlRuntime,
  QueryInput,
  QueryValues,
  TransactionQuery,
} from './types.mts'

export type BoundedTransactionOptions = {
  connectionTimeoutMs: number
  statementTimeoutMs: number
}

export async function runBoundedTransactionWithClient<Result>(
  options: BoundedTransactionOptions,
  client: pg.PoolClient,
  handler: (query: TransactionQuery) => Promise<Result>,
  runtime?: Pick<PsqlRuntime, 'env' | 'onQueryTiming' | 'errorHandler'>,
): Promise<Result> {
  let transactionMayHaveStarted = false
  let transactionFailed: unknown
  let destroyClient = false
  let queue = Promise.resolve()
  const extras = runtime ? { env: runtime.env, onQueryTiming: runtime.onQueryTiming } : undefined

  function runTransactionQuery<Row extends pg.QueryResultRow = pg.QueryResultRow>(
    input: QueryInput,
    values?: QueryValues,
  ): Promise<pg.QueryResult<Row>> {
    const result = queue.then(async () => {
      if (transactionFailed) throwTransactionFailure(transactionFailed)
      try {
        return await executeClientQuery<Row>(client, input, values, 'write', extras)
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

  const query = Object.assign(runTransactionQuery, { client }) as TransactionQuery
  const controlQuery = (text: string, values?: unknown[]): Promise<pg.QueryResult> =>
    client.query({
      text,
      values,
      query_timeout: options.statementTimeoutMs,
    } as unknown as pg.QueryConfig)

  try {
    await controlQuery('/* withBoundedTransaction */ BEGIN')
    transactionMayHaveStarted = true
    await controlQuery(
      "/* withBoundedTransaction */ SELECT set_config('statement_timeout', $1, true)",
      [`${options.statementTimeoutMs}ms`],
    )
    const result = await handler(query)
    await queue
    if (transactionFailed) throwTransactionFailure(transactionFailed)
    await controlQuery('/* withBoundedTransaction */ COMMIT')
    return result
  } catch (error) {
    await queue
    if (transactionMayHaveStarted) {
      try {
        await controlQuery('/* withBoundedTransaction */ ROLLBACK')
      } catch (rollbackError) {
        destroyClient = true
        reportRollbackFailure(error, rollbackError, runtime?.errorHandler)
      }
    }
    throw error
  } finally {
    if (destroyClient) client.release(true)
    else client.release()
  }
}

function throwTransactionFailure(error: unknown): never {
  if (error instanceof Error) throw error
  throw new Error(`Transaction failed: ${String(error)}`)
}

function reportRollbackFailure(
  primaryError: unknown,
  rollbackError: unknown,
  reportError?: ErrorHandler,
): void {
  if (!reportError) return
  const normalizedPrimaryError = normalizeError(primaryError)
  const aggregate = new AggregateError(
    [normalizedPrimaryError, normalizeError(rollbackError)],
    'PostgreSQL bounded transaction failed and rollback did not complete',
    { cause: normalizedPrimaryError },
  )
  try {
    reportError(aggregate)
  } catch {
    // Cleanup telemetry must never replace the primary transaction failure.
  }
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
