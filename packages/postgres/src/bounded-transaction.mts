import type pg from 'pg'

import { beginOwnedTransaction } from './transaction-resource.mts'
import { runTransactionHandler } from './transactions.mts'
import type { ErrorHandler, PsqlRuntime, TransactionQuery } from './types.mts'

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
  const transaction = await beginOwnedTransaction(
    {
      env: runtime?.env ?? process.env,
      onQueryTiming: runtime?.onQueryTiming,
    } as PsqlRuntime,
    client,
    '/* withBoundedTransaction */',
    options.statementTimeoutMs,
  )
  return runTransactionHandler(transaction, handler, (primary, rollback) =>
    reportBoundedRollbackFailure(primary, rollback, runtime?.errorHandler),
  )
}

export function reportBoundedRollbackFailure(
  primary: unknown,
  rollback: unknown,
  reportError?: ErrorHandler,
): void {
  if (!reportError) return
  const cause = normalizeError(primary)
  try {
    reportError(
      new AggregateError(
        [cause, normalizeError(rollback)],
        'PostgreSQL bounded transaction failed and rollback did not complete',
        { cause },
      ),
    )
  } catch {
    // Cleanup telemetry must never replace the primary transaction failure.
  }
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
