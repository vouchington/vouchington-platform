import type pg from 'pg'

import { executeClientQuery } from './execute-client-query.mts'
import type {
  PsqlRuntime,
  QueryInput,
  QueryPoolLabel,
  QueryValues,
  TransactionQuery,
} from './types.mts'

export async function runQueuedTransactionHandler<Result>(
  runtime: PsqlRuntime,
  client: pg.PoolClient,
  handler: (query: TransactionQuery) => Promise<Result>,
  queryPool: QueryPoolLabel,
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
          return await executeClientQuery<Row>(client, input, values, queryPool, {
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

export function throwFailure(error: unknown): never {
  if (error instanceof Error) throw error
  throw new Error(`Transaction failed: ${String(error)}`)
}
