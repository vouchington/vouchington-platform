import type pg from 'pg'

import { connectWithRetry } from './connect-with-retry.mts'
import type { Transaction } from './create-psql-types.mts'
import { isInTransaction } from './transaction-probe.mts'
import { beginTransactionSession } from './transaction-session.mts'
import type { BeginTransactionOptions, PsqlRuntime, QueryPoolLabel } from './types.mts'

export async function beginTransactionResource(
  runtime: PsqlRuntime,
  options: BeginTransactionOptions,
  annotation: string,
): Promise<Transaction> {
  const client = options.client
  if (client === undefined) {
    return beginOwnedPoolTransaction(
      runtime,
      await connectWithRetry(runtime.pools.write),
      annotation,
    )
  }
  if (isPoolClient(client)) return beginBorrowedTransaction(runtime, client, annotation)
  return beginOwnedPoolTransaction(
    runtime,
    await connectWithRetry(client),
    annotation,
    undefined,
    getPoolLabel(runtime, client),
  )
}

export async function beginOwnedTransaction(
  runtime: PsqlRuntime,
  client: pg.PoolClient,
  annotation: string,
  statementTimeoutMs?: number,
  queryPool?: QueryPoolLabel,
): Promise<Transaction> {
  return beginTransactionSession(runtime, client, {
    annotation,
    ...(statementTimeoutMs === undefined ? {} : { statementTimeoutMs }),
    ...(queryPool === undefined ? {} : { queryPool }),
  })
}

export async function beginOwnedPoolTransaction(
  runtime: PsqlRuntime,
  client: pg.PoolClient,
  annotation: string,
  statementTimeoutMs?: number,
  queryPool?: QueryPoolLabel,
): Promise<Transaction> {
  try {
    if (await isInTransaction(client, statementTimeoutMs))
      throw new Error('Cannot create an owned transaction from an active pool client')
  } catch (error) {
    client.release(true)
    throw error
  }
  return beginOwnedTransaction(runtime, client, annotation, statementTimeoutMs, queryPool)
}

async function beginBorrowedTransaction(
  runtime: PsqlRuntime,
  client: pg.PoolClient,
  annotation: string,
): Promise<Transaction> {
  if (await isInTransaction(client)) {
    throw new Error('Cannot create an owned transaction from an active caller-managed pool client')
  }
  return beginTransactionSession(runtime, client, {
    annotation,
    queryPool: 'client',
    releaseClient: false,
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
