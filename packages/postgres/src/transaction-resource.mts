import type pg from 'pg'

import { acquireClientWithin, connectWithRetry } from './connect-with-retry.mts'
import type { Transaction } from './create-psql-types.mts'
import { assertTransactionIsolationLevel } from './transaction-begin.mts'
import { isInTransaction } from './transaction-probe.mts'
import { beginTransactionSession } from './transaction-session.mts'
import type {
  BeginTransactionOptions,
  PsqlRuntime,
  QueryPoolLabel,
  TransactionIsolationLevel,
} from './types.mts'

export type OwnedPoolTransactionOptions = {
  connectionTimeoutMs?: number
  queryPool?: QueryPoolLabel
  statementTimeoutMs?: number
  isolationLevel?: TransactionIsolationLevel | undefined
}

type OwnedTransactionOptions = Omit<OwnedPoolTransactionOptions, 'connectionTimeoutMs'>

export async function beginTransactionResource(
  runtime: PsqlRuntime,
  options: BeginTransactionOptions,
  annotation: string,
): Promise<Transaction> {
  const { client, isolationLevel } = options
  assertTransactionIsolationLevel(isolationLevel)
  if (client === undefined)
    return beginOwnedPoolTransaction(runtime, runtime.pools.write, annotation, { isolationLevel })
  if (isPoolClient(client))
    return beginBorrowedTransaction(runtime, client, annotation, isolationLevel)
  return beginOwnedPoolTransaction(runtime, client, annotation, {
    queryPool: getPoolLabel(runtime, client),
    isolationLevel,
  })
}

export async function beginOwnedTransaction(
  runtime: PsqlRuntime,
  client: pg.PoolClient,
  annotation: string,
  { statementTimeoutMs, queryPool, isolationLevel }: OwnedTransactionOptions = {},
): Promise<Transaction> {
  return beginTransactionSession(runtime, client, {
    annotation,
    statementTimeoutMs,
    isolationLevel,
    ...(queryPool === undefined ? {} : { queryPool }),
  })
}

/**
 * Begins a transaction on a connection this package acquires from `pool`.
 *
 * Accepting the pool instead of a `pg.PoolClient` is the invariant: a connection
 * returned by `pool.connect()` is idle by construction, so there is no
 * transaction state left to discover and no probe to run. A caller holding a
 * client whose state it cannot vouch for cannot reach this function -- passing
 * one is a type error -- and must use the borrowed path, which probes.
 */
export async function beginOwnedPoolTransaction(
  runtime: PsqlRuntime,
  pool: pg.Pool,
  annotation: string,
  options: OwnedPoolTransactionOptions = {},
): Promise<Transaction> {
  const client =
    options.connectionTimeoutMs === undefined
      ? await connectWithRetry(pool)
      : await acquireClientWithin(pool, options.connectionTimeoutMs)
  return beginOwnedTransaction(runtime, client, annotation, options)
}

async function beginBorrowedTransaction(
  runtime: PsqlRuntime,
  client: pg.PoolClient,
  annotation: string,
  isolationLevel: TransactionIsolationLevel | undefined,
): Promise<Transaction> {
  if (await isInTransaction(client)) {
    throw new Error('Cannot create an owned transaction from an active caller-managed pool client')
  }
  return beginTransactionSession(runtime, client, {
    annotation,
    queryPool: 'client',
    releaseClient: false,
    isolationLevel,
  })
}

function getPoolLabel(runtime: PsqlRuntime, pool: pg.Pool): QueryPoolLabel {
  if (pool === runtime.pools.read) return 'read'
  if (pool === runtime.pools.write) return 'write'
  return 'client'
}

function isPoolClient(client: pg.Pool | pg.PoolClient): client is pg.PoolClient {
  return 'release' in client
}
