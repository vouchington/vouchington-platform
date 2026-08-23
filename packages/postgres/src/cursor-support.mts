import { createRequire } from 'node:module'
import { Pool, type PoolClient, type Submittable } from 'pg'
import type { SQLStatement } from 'sql-template-strings'

import { connectWithRetry } from './connect-with-retry.mts'
import type { PsqlRuntime, QueryOptions, QueryPoolLabel } from './types.mts'

export type CursorInstance<Row = Record<string, unknown>> = Submittable & {
  read(rows: number): Promise<Row[]>
  close(): Promise<void>
}

type CursorConstructor = new <Row = Record<string, unknown>>(
  text: string,
  values?: unknown[],
) => CursorInstance<Row>

export type CursorQueryInput = string | SQLStatement
export type CursorQueryValues = ReadonlyArray<unknown> | undefined
export type CursorGeneratorOptions = QueryOptions & {
  batchSize?: number
  abortSignal?: AbortSignal
}

const require = createRequire(import.meta.url)
export const Cursor = require('pg-cursor') as CursorConstructor

export function normalizeCursorValues(values?: CursorQueryValues): unknown[] | undefined {
  return values ? [...values] : undefined
}

function isQueryOptions(value: unknown): value is QueryOptions {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function resolveCursorOptions<T extends CursorGeneratorOptions>(
  valuesOrOptions?: CursorQueryValues | T,
  options: T = {} as T,
): { finalOptions: T; values?: CursorQueryValues } {
  if (isQueryOptions(valuesOrOptions)) {
    return { finalOptions: { ...options, ...valuesOrOptions } }
  }
  return { finalOptions: options, values: valuesOrOptions }
}

export async function acquireCursorClient(
  runtime: PsqlRuntime,
  options: CursorGeneratorOptions,
): Promise<{
  client: PoolClient
  releaseClient: boolean
}> {
  if (options.client) {
    if (options.client instanceof Pool) {
      return { client: await connectWithRetry(options.client), releaseClient: true }
    }
    return { client: options.client, releaseClient: false }
  }

  const pool = options.readOnly === false ? runtime.pools.write : runtime.pools.read
  return { client: await connectWithRetry(pool), releaseClient: true }
}

export function getCursorPoolLabel(options: CursorGeneratorOptions): QueryPoolLabel {
  if (options.client) return 'client'
  return options.readOnly === false ? 'write' : 'read'
}
