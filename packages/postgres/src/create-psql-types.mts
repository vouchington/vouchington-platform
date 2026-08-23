import type pg from 'pg'

import type { ErrorHandler, QueryTimingHandler, TransactionQuery } from './types.mts'
import type { BoundedTransactionOptions } from './bounded-transaction.mts'
import type { PipelineBatchOptions } from './pipeline-batch.mts'
import type { QueryInput, QueryOptions, QueryValues } from './types.mts'
import type {
  CursorGeneratorOptions,
  CursorHandlerOptions,
  CursorQueryInput,
  CursorQueryValues,
} from './cursor-types.mts'
import type { RunMigrationsOptions } from './migration-runner/fixed-migrations.mts'
import type { MigrationLogger } from './migration-runner/migration-logger.mts'

export interface CreatePsqlOptions {
  connectionString: string
  readConnectionString?: string
  env?: NodeJS.ProcessEnv
  errorHandler?: ErrorHandler
  onQueryTiming?: QueryTimingHandler
  vector?: boolean
  databaseName?: string
  migrationExtensions?: readonly string[]
  onClose?: (close: () => Promise<void>) => void
}

export interface Psql {
  writePool: pg.Pool
  readPool: pg.Pool
  advisoryLockPool: pg.Pool
  query: QueryMethod
  read: QueryMethod
  write: QueryMethod
  pipelineBatch: <Row extends pg.QueryResultRow = pg.QueryResultRow>(
    queries: readonly QueryInput[],
    options?: PipelineBatchOptions,
  ) => Promise<pg.QueryResult<Row>[]>
  withTransaction: <Result>(
    handler: (query: TransactionQuery) => Promise<Result>,
  ) => Promise<Result>
  withTransactionOptions: <Result>(
    options: QueryOptions,
    handler: (query: TransactionQuery) => Promise<Result>,
  ) => Promise<Result>
  withBoundedTransaction: <Result>(
    options: BoundedTransactionOptions,
    handler: (query: TransactionQuery) => Promise<Result>,
  ) => Promise<Result>
  createAsyncGeneratorFromCursor: <Row = Record<string, unknown>>(
    input: CursorQueryInput,
    valuesOrOptions?: CursorQueryValues | CursorGeneratorOptions,
    options?: CursorGeneratorOptions,
  ) => AsyncGenerator<Row, void, void>
  executeHandlerWithCursorInBatches: <Row = Record<string, unknown>>(
    input: CursorQueryInput,
    valuesOrOptions?: CursorQueryValues | CursorHandlerOptions<Row>,
    options?: CursorHandlerOptions<Row>,
  ) => Promise<void>
  runMigrations: (
    folder: string,
    loggerOrOptions?: RunMigrationsOptions | MigrationLogger,
  ) => Promise<void>
  close: () => Promise<void>
}

type QueryMethod = <Row extends pg.QueryResultRow = pg.QueryResultRow>(
  input: QueryInput,
  valuesOrOptions?: QueryValues | QueryOptions,
  options?: QueryOptions,
) => Promise<pg.QueryResult<Row>>
