import type pg from 'pg'
import { debuglog } from 'node:util'

import { executeClientQuery } from './execute-client-query.mts'
import type {
  PsqlRuntime,
  QueryInput,
  QueryOptions,
  QueryPoolLabel,
  QueryValues,
} from './types.mts'

const debug = debuglog('psql')

export function createQueryApi(runtime: PsqlRuntime) {
  const query = async <Row extends pg.QueryResultRow = pg.QueryResultRow>(
    input: QueryInput,
    valuesOrOptions?: QueryValues | QueryOptions,
    options: QueryOptions = {},
  ): Promise<pg.QueryResult<Row>> => {
    let values: QueryValues
    let finalOptions = options

    if (isQueryOptions(valuesOrOptions) && !Array.isArray(valuesOrOptions)) {
      finalOptions = valuesOrOptions
    } else {
      values = valuesOrOptions as QueryValues
    }

    const client =
      finalOptions.client || (finalOptions.readOnly ? runtime.pools.read : runtime.pools.write)

    try {
      runtime.onBeforeQuery?.(input, values)
    } catch {
      // capture is best-effort; never break real queries
    }

    try {
      if (finalOptions.query) {
        return await finalOptions.query<Row>(input, values)
      }

      const poolLabel: QueryPoolLabel = finalOptions.client
        ? 'client'
        : client === runtime.pools.read
          ? 'read'
          : 'write'
      return await executeClientQuery<Row>(client, input, values, poolLabel, {
        env: runtime.env,
        onQueryTiming: runtime.onQueryTiming,
      })
    } catch (err) {
      debug('ERROR: query failed!')
      debug('Database Name: %o', runtime.databaseName)
      debug('Pool: %o', getPoolLabel(finalOptions, client, runtime))
      debug('Query: %o', input)
      if (Array.isArray(values)) debug('Values: %o', values)
      debug('Error: %o', err)
      throw err
    }
  }

  const write = <Row extends pg.QueryResultRow = pg.QueryResultRow>(
    input: QueryInput,
    valuesOrOptions?: QueryValues | QueryOptions,
    options: QueryOptions = {},
  ) => query<Row>(input, valuesOrOptions, { ...options, readOnly: false })

  const read = <Row extends pg.QueryResultRow = pg.QueryResultRow>(
    input: QueryInput,
    valuesOrOptions?: QueryValues | QueryOptions,
    options: QueryOptions = {},
  ) => query<Row>(input, valuesOrOptions, { ...options, readOnly: true })

  return { query, read, write }
}

function isQueryOptions(value: unknown): value is QueryOptions {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getPoolLabel(
  options: QueryOptions,
  client: QueryOptions['client'],
  runtime: PsqlRuntime,
): 'query' | 'client' | 'read' | 'write' {
  if (options.query) return 'query'
  if (options.client) return 'client'
  return client === runtime.pools.read ? 'read' : 'write'
}
