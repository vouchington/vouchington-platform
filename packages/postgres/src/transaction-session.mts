import type pg from 'pg'

import { executeClientQuery, type ClientQueryTimingExtras } from './execute-client-query.mts'
import { beginTransactionBatch } from './transaction-begin.mts'
import {
  recoverFailedCallerTransaction,
  setTransactionCleanupOutcome,
} from './transaction-cleanup.mts'
import { throwFailure } from './transaction-queue.mts'
import type { Transaction } from './create-psql-types.mts'
import type {
  PsqlRuntime,
  QueryInput,
  QueryPoolLabel,
  QueryValues,
  TransactionQuery,
} from './types.mts'

export type TransactionSessionOptions = {
  annotation: string
  statementTimeoutMs?: number
  releaseClient?: boolean
  queryPool?: QueryPoolLabel
}

type Extras = Omit<ClientQueryTimingExtras, 'onQueryTiming' | 'queryTimeoutMs'>

/**
 * Opens a transaction session without a round trip of its own. `BEGIN` and the
 * statement timeout are pipelined with the first statement; a session settled
 * before any statement sends `BEGIN` alone first, so a nested-`BEGIN` client is
 * never committed.
 */
export async function beginTransactionSession(
  runtime: PsqlRuntime,
  client: pg.PoolClient,
  options: TransactionSessionOptions,
): Promise<Transaction> {
  const control = (text: string, values?: QueryValues, extras?: Extras) =>
    executeClientQuery(client, `${options.annotation} ${text}`, values, 'client', {
      onQueryTiming: runtime.onQueryTiming,
      queryTimeoutMs: options.statementTimeoutMs,
      ...extras,
    })
  const beginControls = (extras?: Extras, statements = true) => [
    () => control('BEGIN', undefined, extras),
    ...(options.statementTimeoutMs === undefined || !statements
      ? []
      : [
          () =>
            control(
              "SELECT set_config('statement_timeout', $1, true)",
              [`${options.statementTimeoutMs}ms`],
              extras,
            ),
        ]),
  ]

  let failed: unknown
  let hasFailed = false
  let begun = false
  let abandoned = false
  let queue = Promise.resolve()
  let released = false
  let transaction!: Transaction
  let settlement: { operation: 'COMMIT' | 'ROLLBACK'; promise: Promise<void> } | undefined
  let compensatingRollback: Promise<void> | undefined
  const release = (destroy = false) => {
    if (!released && options.releaseClient !== false) {
      if (destroy) client.release(true)
      else client.release()
    }
    released = true
  }
  function fail(error: unknown): never {
    failed = error
    hasFailed = true
    throw error
  }
  const begin = async <T,>(first?: (extras: Extras) => Promise<T>) => {
    begun = true
    const extras = { pipelined: true, batchSize: beginControls().length + 1 }
    const outcome = first
      ? await beginTransactionBatch(client, beginControls(extras), () => first(extras))
      : await beginTransactionBatch(client, beginControls(undefined, false), async () => undefined)
    if (outcome.kind === 'failed') {
      abandoned = true
      release(true)
      fail(outcome.error)
    }
    return outcome.first
  }
  const query = Object.assign(
    (<Row extends pg.QueryResultRow = pg.QueryResultRow>(
      input: QueryInput,
      values?: QueryValues,
    ) => {
      if (settlement) return Promise.reject(new Error('Transaction is already settled'))
      const run = (extras?: Extras) =>
        executeClientQuery<Row>(client, input, values, options.queryPool ?? 'write', {
          onQueryTiming: runtime.onQueryTiming,
          ...extras,
        })
      const result = queue.then(async () => {
        if (hasFailed) throwFailure(failed)
        if (!begun) {
          const first = await begin(run)
          if (first.status === 'rejected') return fail(first.reason)
          return first.value
        }
        try {
          return await run()
        } catch (error) {
          return fail(error)
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
    // Nothing ran yet: BEGIN alone, so a nested-BEGIN client is discarded before COMMIT is sent.
    if (!begun) await begin().catch(() => undefined)
    if (abandoned) {
      // The connection was discarded, which ends any server-side transaction.
      if (operation === 'COMMIT') throwFailure(failed)
      return
    }
    if (operation === 'COMMIT' && hasFailed) {
      try {
        await control('ROLLBACK')
        release()
        setTransactionCleanupOutcome(transaction, { kind: 'rolled-back' })
      } catch (error) {
        release(true)
        setTransactionCleanupOutcome(transaction, { error, kind: 'rollback-failed' })
      }
      throwFailure(failed)
    }
    try {
      await control(operation)
      release()
    } catch (error) {
      release(true)
      setTransactionCleanupOutcome(transaction, {
        error,
        kind: 'control-failed',
        ...(operation === 'COMMIT' && options.releaseClient === false
          ? { rollback: () => (compensatingRollback ??= control('ROLLBACK').then(() => undefined)) }
          : {}),
      })
      throw error
    }
  }
  transaction = Object.assign(query, {
    commit: () => settle('COMMIT'),
    rollback: () => settle('ROLLBACK'),
    [Symbol.asyncDispose]: async () => {
      if (!settlement) return settle('ROLLBACK')
      try {
        await settlement.promise
      } catch (error) {
        // An explicit settlement reports its own failure.
        if (options.releaseClient === false)
          await recoverFailedCallerTransaction(transaction, runtime.errorHandler, error)
      }
    },
  }) as Transaction
  setTransactionCleanupOutcome(transaction, { kind: 'none' })
  return transaction
}
