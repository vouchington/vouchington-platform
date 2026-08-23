import pg from 'pg'
import { SQLStatement } from 'sql-template-strings'

import { connectWithRetry } from './connect-with-retry.mts'
import { executeClientQuery } from './execute-client-query.mts'
import { assertLeadingQueryAnnotation } from './prepared-statement-name.mts'
import type { PsqlRuntime, QueryInput, QueryValues } from './types.mts'

type SnapshotQuery = {
  text: string
  values: QueryValues
}

export const PIPELINE_BATCH_MAX = 16

export type PipelineBatchOptions = {
  readOnly?: boolean
}

type PipelineFlag = { pipeline: boolean }

export function createPipelineBatch(runtime: PsqlRuntime) {
  return async function pipelineBatch<Row extends pg.QueryResultRow = pg.QueryResultRow>(
    queries: readonly QueryInput[],
    options: PipelineBatchOptions = {},
  ): Promise<pg.QueryResult<Row>[]> {
    if (queries.length > PIPELINE_BATCH_MAX) {
      throw new Error(
        `pipelineBatch supports at most ${PIPELINE_BATCH_MAX} queries, got ${queries.length}`,
      )
    }
    if (queries.length === 0) return []

    const validated = queries.map((query) => snapshotPipelineQuery(query, runtime.env))
    for (const query of validated) {
      try {
        runtime.onBeforeQuery?.(query.text, query.values)
      } catch {
        // capture is best-effort; never break real queries
      }
    }
    const readOnly = options.readOnly !== false
    const pool = readOnly ? runtime.pools.read : runtime.pools.write
    const poolLabel = readOnly ? 'read' : 'write'
    const client = await connectWithRetry(pool)
    const flag = client as unknown as PipelineFlag
    const previous = flag.pipeline
    flag.pipeline = true
    const pending: Promise<pg.QueryResult<Row>>[] = []
    try {
      for (const query of validated) {
        pending.push(
          executeClientQuery<Row>(client, query.text, query.values, poolLabel, {
            env: runtime.env,
            onQueryTiming: runtime.onQueryTiming,
            pipelined: true,
            batchSize: validated.length,
          }),
        )
      }
      const settled = await Promise.allSettled(pending)
      const firstRejection = settled.find((result) => result.status === 'rejected')
      if (firstRejection?.status === 'rejected') throw firstRejection.reason
      return settled.map((result) => (result as PromiseFulfilledResult<pg.QueryResult<Row>>).value)
    } finally {
      await Promise.allSettled(pending)
      try {
        flag.pipeline = previous
      } finally {
        if (shouldDestroyClient(client)) client.release(true)
        else client.release()
      }
    }
  }
}

function snapshotPipelineQuery(query: QueryInput, env: NodeJS.ProcessEnv): SnapshotQuery {
  if (typeof query === 'string') {
    rejectSubmittable(query)
    assertLeadingQueryAnnotation(query, env)
    rejectExcludedStatement(query)
    return { text: query, values: undefined }
  }
  if (!isSQLStatement(query)) {
    rejectSubmittable(query)
    throw new Error('pipelineBatch accepts only annotated SQL strings or SQLStatement values')
  }
  rejectSubmittable(query)
  const text = query.text
  const values = query.values ? [...query.values] : undefined
  assertLeadingQueryAnnotation(text, env)
  rejectExcludedStatement(text)
  return { text, values }
}

function isSQLStatement(value: unknown): value is SQLStatement {
  return value instanceof SQLStatement
}

function rejectSubmittable(value: unknown): void {
  if (typeof value === 'object' && value !== null && 'submit' in value) {
    const submit = (value as { submit?: unknown }).submit
    if (typeof submit === 'function') {
      throw new Error('pipelineBatch does not accept Submittable query objects')
    }
  }
}

function shouldDestroyClient(client: pg.PoolClient): boolean {
  return (client as { _queryable?: boolean })._queryable === false
}

function rejectExcludedStatement(sqlText: string): string {
  const statement = stripSqlComments(sqlText)
  if (/^copy\b/i.test(statement)) {
    throw new Error('pipelineBatch does not accept COPY statements')
  }
  if (/^(?:begin|commit|rollback|abort|end|start\s+transaction)\b/i.test(statement)) {
    throw new Error('pipelineBatch does not accept transaction-control statements')
  }
  return statement
}

function stripSqlComments(sqlText: string): string {
  let output = ''
  let index = 0
  let blockDepth = 0
  let inLineComment = false
  while (index < sqlText.length) {
    const current = sqlText[index]!
    const next = sqlText[index + 1]
    if (inLineComment) {
      if (current === '\n') {
        inLineComment = false
        output += ' '
      }
      index += 1
      continue
    }
    if (blockDepth > 0) {
      if (current === '/' && next === '*') {
        blockDepth += 1
        index += 2
        continue
      }
      if (current === '*' && next === '/') {
        blockDepth -= 1
        index += 2
        if (blockDepth === 0) output += ' '
        continue
      }
      index += 1
      continue
    }
    if (current === '-' && next === '-') {
      inLineComment = true
      index += 2
      continue
    }
    if (current === '/' && next === '*') {
      blockDepth = 1
      index += 2
      continue
    }
    output += current
    index += 1
  }
  return output.replace(/\s+/g, ' ').trim()
}
