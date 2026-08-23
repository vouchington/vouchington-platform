import type pg from 'pg'

import type { BoundedTransactionOptions } from './bounded-transaction.mts'
import type {
  CursorGeneratorOptions,
  CursorHandlerOptions,
  CursorQueryInput,
  CursorQueryValues,
} from './cursor-types.mts'
import type { RunMigrationsOptions } from './migration-runner/fixed-migrations.mts'
import type { MigrationLogger } from './migration-runner/migration-logger.mts'
import type { MigrationTimeouts } from './migration-runner/migration-options.mts'
import type { PipelineBatchOptions } from './pipeline-batch.mts'
import type {
  BeforeQueryHandler,
  ErrorHandler,
  QueryInput,
  QueryOptions,
  QueryTimingHandler,
  QueryValues,
  TransactionQuery,
} from './types.mts'

export interface CreatePsqlOptions {
  connectionString: string
  readConnectionString?: string
  env?: NodeJS.ProcessEnv
  errorHandler?: ErrorHandler
  onQueryTiming?: QueryTimingHandler
  onBeforeQuery?: BeforeQueryHandler
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
  withMigrationSession: <Result>(
    handler: (client: pg.PoolClient) => Promise<Result>,
    timeouts?: Partial<MigrationTimeouts>,
  ) => Promise<Result>
  close: () => Promise<void>
}

type QueryMethod = <Row extends pg.QueryResultRow = pg.QueryResultRow>(
  input: QueryInput,
  valuesOrOptions?: QueryValues | QueryOptions,
  options?: QueryOptions,
) => Promise<pg.QueryResult<Row>>
