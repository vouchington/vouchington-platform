import type pg from 'pg'
import type { SQLStatement } from 'sql-template-strings'

export type { PoolClient } from 'pg'

export type QueryInput = string | SQLStatement
export type QueryValues = ReadonlyArray<unknown> | undefined

export interface QueryExecutor {
  <Row extends pg.QueryResultRow = pg.QueryResultRow>(
    input: QueryInput,
    values?: QueryValues,
  ): Promise<pg.QueryResult<Row>>
}

export type TransactionQuery = QueryExecutor & {
  client: pg.PoolClient
}

export interface QueryOptions {
  client?: pg.PoolClient | pg.Pool
  query?: QueryExecutor
  readOnly?: boolean
}

/** A stricter isolation level than PostgreSQL's `read committed` default. */
export type TransactionIsolationLevel = 'serializable' | 'repeatable read'

export interface BeginTransactionOptions {
  client?: pg.PoolClient | pg.Pool
  /** Opens the transaction with `BEGIN ISOLATION LEVEL ...`, so no separate `SET TRANSACTION` can fail after it. */
  isolationLevel?: TransactionIsolationLevel
}

export type QueryPoolLabel = 'read' | 'write' | 'client'

export interface QueryTimingInput {
  annotation: string | null
  pool: QueryPoolLabel
  durationMs: number
  rowCount: number
  error: boolean
  cursorBatches?: number | undefined
  pipelined?: boolean | undefined
  batchSize?: number | undefined
}

export type QueryTimingHandler = (input: QueryTimingInput) => void
export type BeforeQueryHandler = (input: QueryInput, values?: QueryValues) => void
export type ErrorHandler = (error: Error) => void

export interface PsqlPools {
  write: pg.Pool
  read: pg.Pool
  advisoryLock: pg.Pool
}

export interface PsqlRuntime {
  pools: PsqlPools
  env: NodeJS.ProcessEnv
  errorHandler: ErrorHandler
  onQueryTiming?: QueryTimingHandler | undefined
  onBeforeQuery?: BeforeQueryHandler | undefined
  databaseName?: string | undefined
}
