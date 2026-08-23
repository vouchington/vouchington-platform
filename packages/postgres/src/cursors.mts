import { performance } from 'node:perf_hooks'

import {
  assertLeadingQueryAnnotation,
  extractLeadingQueryAnnotation,
} from './prepared-statement-name.mts'
import {
  acquireCursorClient,
  Cursor,
  getCursorPoolLabel,
  normalizeCursorValues,
  resolveCursorOptions,
  type CursorGeneratorOptions,
  type CursorInstance,
  type CursorQueryInput,
  type CursorQueryValues,
} from './cursor-support.mts'
import type { PsqlRuntime } from './types.mts'

type CursorHandlerOptions<Row> = CursorGeneratorOptions & {
  handler: (rows: Row[]) => Promise<void>
}

export function createCursorApi(runtime: PsqlRuntime) {
  async function executeHandlerWithCursorInBatches<Row = Record<string, unknown>>(
    input: CursorQueryInput,
    valuesOrOptions?: CursorQueryValues | CursorHandlerOptions<Row>,
    options: CursorHandlerOptions<Row> = {} as CursorHandlerOptions<Row>,
  ): Promise<void> {
    const { finalOptions, values } = resolveCursorOptions(valuesOrOptions, options)
    if (!finalOptions.handler) throw new Error('handler is required')
    const session = await openCursor<Row>(runtime, input, values, finalOptions)
    try {
      while (!finalOptions.abortSignal?.aborted) {
        const rows = await session.read()
        if (!rows) break
        await finalOptions.handler(rows)
      }
    } finally {
      await session.close()
    }
  }

  async function* createAsyncGeneratorFromCursor<Row = Record<string, unknown>>(
    input: CursorQueryInput,
    valuesOrOptions?: CursorQueryValues | CursorGeneratorOptions,
    options: CursorGeneratorOptions = {},
  ): AsyncGenerator<Row, void, void> {
    const { finalOptions, values } = resolveCursorOptions(valuesOrOptions, options)
    const session = await openCursor<Row>(runtime, input, values, finalOptions)
    try {
      while (!finalOptions.abortSignal?.aborted) {
        const rows = await session.read()
        if (!rows) break
        yield* rows
      }
    } finally {
      await session.close()
    }
  }

  return { executeHandlerWithCursorInBatches, createAsyncGeneratorFromCursor }
}

async function openCursor<Row>(
  runtime: PsqlRuntime,
  input: CursorQueryInput,
  values: CursorQueryValues | undefined,
  options: CursorGeneratorOptions,
) {
  const { batchSize = 1000, abortSignal } = options
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error('batchSize must be a positive integer')
  }

  const statementText = typeof input === 'string' ? input : input.text
  assertLeadingQueryAnnotation(statementText, runtime.env)
  const statementValues: CursorQueryValues =
    values ?? (typeof input === 'string' ? undefined : input.values)
  const normalizedValues = normalizeCursorValues(statementValues)
  const poolLabel = getCursorPoolLabel(options)
  const annotation = extractLeadingQueryAnnotation(statementText)
  const startedAt = performance.now()
  let batches = 0
  let rowCount = 0
  let error = false
  let cursor: CursorInstance<Row> | undefined
  const acquired = abortSignal?.aborted
    ? { client: undefined, releaseClient: false }
    : await acquireCursorClient(runtime, options)

  if (acquired.client && !abortSignal?.aborted) {
    cursor = acquired.client.query(
      new Cursor<Row>(statementText, normalizedValues),
    ) as CursorInstance<Row>
  }

  return {
    async read(): Promise<Row[] | undefined> {
      if (!cursor || abortSignal?.aborted) return undefined
      try {
        const rows = await cursor.read(batchSize)
        if (rows.length === 0) return undefined
        batches += 1
        rowCount += rows.length
        return rows
      } catch (caught) {
        error = true
        throw caught
      }
    },
    async close(): Promise<void> {
      let operationError: unknown
      try {
        await cursor?.close()
      } catch (caught) {
        error = true
        operationError = caught
      }
      if (acquired.releaseClient) acquired.client?.release()
      try {
        runtime.onQueryTiming?.({
          annotation,
          pool: poolLabel,
          durationMs: performance.now() - startedAt,
          rowCount,
          error,
          cursorBatches: batches,
        })
      } catch {
        // timing is best-effort
      }
      if (operationError) {
        throw operationError instanceof Error ? operationError : new Error('cursor close failed')
      }
    },
  }
}
