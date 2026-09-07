import type pg from 'pg'

import { executeClientQuery } from './execute-client-query.mts'
import type { Transaction } from './create-psql-types.mts'
import type { PsqlRuntime, QueryInput, QueryValues, TransactionQuery } from './types.mts'

export type TransactionSessionOptions = {
  annotation: string
  statementTimeoutMs?: number
  releaseClient?: boolean
}

type CleanupOutcome =
  | { kind: 'none' }
  | { kind: 'rolled-back' }
  | { error: unknown; kind: 'control-failed' }
  | { error: unknown; kind: 'rollback-failed' }

const cleanupOutcomes = new WeakMap<object, CleanupOutcome>()

export function getTransactionCleanupOutcome(transaction: Transaction): CleanupOutcome {
  return cleanupOutcomes.get(transaction) ?? { kind: 'none' }
}

export async function beginTransactionSession(
  runtime: PsqlRuntime,
  client: pg.PoolClient,
  options: TransactionSessionOptions,
): Promise<Transaction> {
  const control = (text: string, values?: QueryValues) =>
    executeClientQuery(client, `${options.annotation} ${text}`, values, 'client', {
      env: runtime.env,
      onQueryTiming: runtime.onQueryTiming,
      queryTimeoutMs: options.statementTimeoutMs,
    })
  try {
    await control('BEGIN')
    if (options.statementTimeoutMs !== undefined) {
      await control("SELECT set_config('statement_timeout', $1, true)", [
        `${options.statementTimeoutMs}ms`,
      ])
    }
  } catch (error) {
    if (options.releaseClient !== false) client.release(true)
    throw error
  }

  let failed: unknown
  let hasFailed = false
  let queue = Promise.resolve()
  let released = false
  let transaction!: Transaction
  let settlement: { operation: 'COMMIT' | 'ROLLBACK'; promise: Promise<void> } | undefined
  const release = (destroy = false) => {
    if (!released && options.releaseClient !== false) {
      if (destroy) client.release(true)
      else client.release()
    }
    released = true
  }
  const query = Object.assign(
    (<Row extends pg.QueryResultRow = pg.QueryResultRow>(
      input: QueryInput,
      values?: QueryValues,
    ) => {
      if (settlement) return Promise.reject(new Error('Transaction is already settled'))
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
  const settle = (operation: 'COMMIT' | 'ROLLBACK'): Promise<void> => {
    if (settlement) {
      if (settlement.operation === operation) return settlement.promise
      return Promise.reject(new Error('Transaction is already settled'))
    }
    const promise = settleTransaction(operation)
    settlement = { operation, promise }
    return promise
  }
  async function settleTransaction(operation: 'COMMIT' | 'ROLLBACK'): Promise<void> {
    await queue
    if (operation === 'COMMIT' && hasFailed) {
      try {
        await control('ROLLBACK')
        release()
        cleanupOutcomes.set(transaction, { kind: 'rolled-back' })
      } catch (error) {
        release(true)
        cleanupOutcomes.set(transaction, { error, kind: 'rollback-failed' })
      }
      throwFailure(failed)
    }
    try {
      await control(operation)
      release()
    } catch (error) {
      release(true)
      cleanupOutcomes.set(transaction, { error, kind: 'control-failed' })
      throw error
    }
  }
  transaction = Object.assign(query, {
    commit: () => settle('COMMIT'),
    rollback: () => settle('ROLLBACK'),
    [Symbol.asyncDispose]: () => (settlement ? settlement.promise : settle('ROLLBACK')),
  }) as Transaction
  cleanupOutcomes.set(transaction, { kind: 'none' })
  return transaction
}

function throwFailure(error: unknown): never {
  if (error instanceof Error) throw error
  throw new Error(`Transaction failed: ${String(error)}`)
}
