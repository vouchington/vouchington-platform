import pg from 'pg'
import { performance } from 'node:perf_hooks'

import { withConnectRetry } from './connect-with-retry.mts'
import {
  assertLeadingQueryAnnotation,
  buildPreparedStatementName,
  extractLeadingQueryAnnotation,
} from './prepared-statement-name.mts'
import type {
  QueryInput,
  QueryPoolLabel,
  QueryTimingHandler,
  QueryTimingInput,
  QueryValues,
} from './types.mts'

export type ClientQueryTimingExtras = Pick<QueryTimingInput, 'pipelined' | 'batchSize'> & {
  onQueryTiming?: QueryTimingHandler | undefined
  env?: NodeJS.ProcessEnv | undefined
}

export async function executeClientQuery<Row extends pg.QueryResultRow = pg.QueryResultRow>(
  client: pg.PoolClient | pg.Pool,
  input: QueryInput,
  values: QueryValues,
  poolLabel: QueryPoolLabel,
  extras?: ClientQueryTimingExtras,
): Promise<pg.QueryResult<Row>> {
  const { config, annotation } = buildQueryConfig(input, values, extras?.env)
  const start = performance.now()
  const pipelined = extras?.pipelined
  const batchSize = extras?.batchSize

  try {
    const result =
      client instanceof pg.Pool
        ? await withConnectRetry(() => client.query<Row>(config))
        : await client.query<Row>(config)
    recordQueryTiming(extras?.onQueryTiming, {
      annotation,
      pool: poolLabel,
      durationMs: performance.now() - start,
      rowCount: result.rowCount ?? 0,
      error: false,
      ...(pipelined === undefined ? {} : { pipelined }),
      ...(batchSize === undefined ? {} : { batchSize }),
    })
    return result
  } catch (error) {
    recordQueryTiming(extras?.onQueryTiming, {
      annotation,
      pool: poolLabel,
      durationMs: performance.now() - start,
      rowCount: 0,
      error: true,
      ...(pipelined === undefined ? {} : { pipelined }),
      ...(batchSize === undefined ? {} : { batchSize }),
    })
    throw error
  }
}

function buildQueryConfig(
  input: QueryInput,
  values: QueryValues,
  env?: NodeJS.ProcessEnv,
): { config: pg.QueryConfig; annotation: string | null } {
  if (typeof input === 'string') {
    assertLeadingQueryAnnotation(input, env)
    const annotation = extractLeadingQueryAnnotation(input)
    const config: pg.QueryConfig = { text: input }
    if (values !== undefined) config.values = [...values]
    if (annotation) config.name = buildPreparedStatementName(input)
    return { config, annotation }
  }

  const annotation = extractLeadingQueryAnnotation(input.text)
  assertLeadingQueryAnnotation(input.text, env)
  const config: pg.QueryConfig = {
    text: input.text,
    values: input.values,
    name: buildPreparedStatementName(input.text, input.name),
  }
  return { config, annotation }
}

function recordQueryTiming(handler: QueryTimingHandler | undefined, input: QueryTimingInput): void {
  if (!handler) return
  try {
    handler(input)
  } catch {
    // timing is best-effort
  }
}
