import {
  reportBoundedRollbackFailure,
  type BoundedTransactionOptions,
} from './bounded-transaction.mts'
import type { Transaction } from './create-psql-types.mts'
import { beginOwnedPoolTransaction } from './transaction-resource.mts'
import { runTransactionHandler } from './transactions.mts'
import type { PsqlRuntime, TransactionQuery } from './types.mts'

export type { BoundedTransactionOptions } from './bounded-transaction.mts'

export function createBoundedTransactionApi(runtime: PsqlRuntime) {
  const beginBoundedTransaction = async (
    options: BoundedTransactionOptions,
    annotation = '/* beginBoundedTransaction */',
  ): Promise<Transaction> =>
    beginOwnedPoolTransaction(runtime, runtime.pools.write, annotation, {
      connectionTimeoutMs: options.connectionTimeoutMs,
      statementTimeoutMs: options.statementTimeoutMs,
    })
  const withBoundedTransaction = async <Result,>(
    options: BoundedTransactionOptions,
    handler: (query: TransactionQuery) => Promise<Result>,
  ): Promise<Result> =>
    runTransactionHandler(
      await beginBoundedTransaction(options, '/* withBoundedTransaction */'),
      handler,
      (primary, rollback) => reportBoundedRollbackFailure(primary, rollback, runtime.errorHandler),
    )
  return { beginBoundedTransaction, withBoundedTransaction }
}
