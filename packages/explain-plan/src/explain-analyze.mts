import { randomUUID } from 'node:crypto'
import { functionCallsSince, readTransactionFunctionCalls } from './function-calls.mts'
import { buildExplainPreparedStatementText, buildPreparedArgumentSql } from './prepared.mts'
import type { ExplainPlanCacheMode, ExplainResult, WithExplainClient } from './types.mts'

export const LEADING_COMMENT_PATTERN = /^\s*\/\*(.*?)\*\/\s*/s

export interface ExplainAnalyzeOptions {
  /** Supplies one dedicated connection per capture. */
  withClient: WithExplainClient
  name: string
  text: string
  values?: readonly unknown[]
  /** Defaults to `off`, which keeps plans comparable across runs. */
  jit?: 'on' | 'off'
  planCacheMode?: ExplainPlanCacheMode
  /** Extra transaction-local settings applied before the statement is prepared. */
  localSettings?: Readonly<Record<string, string>>
  /** A fixed `work_mem` makes spill detection meaningful; omitted leaves the server value. */
  workMem?: string
  /** EXPLAIN without executing; only plan costs are meaningful. */
  planOnly?: boolean
  /** Recreates session-local objects before the measured statement is prepared. */
  setupSql?: string
  /** Comment text prefixed to every statement the capture issues. Defaults to `explain-plan`. */
  statementTag?: string
  /** Receives rollback and deallocate failures that must not mask the original error. */
  onCleanupError?: (error: unknown) => void
}

/**
 * Captures `EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT JSON)` for one statement inside a transaction
 * that is always rolled back, so data-modifying statements leave no trace.
 */
export async function explainAnalyze(options: ExplainAnalyzeOptions): Promise<ExplainResult> {
  const { name, text, values = [], onCleanupError = () => {} } = options
  const tag = `/* ${options.statementTag ?? 'explain-plan'} */`
  const jit = options.jit ?? 'off'
  const planCacheMode = options.planCacheMode ?? 'auto'
  const preparedName = `explain_${randomUUID().replaceAll('-', '')}`
  const cleanText = text.replace(LEADING_COMMENT_PATTERN, '')
  const settings: Record<string, string> = {
    ...options.localSettings,
    jit,
    plan_cache_mode: planCacheMode,
  }
  if (options.workMem !== undefined) settings['work_mem'] = options.workMem

  const { rows, functionCalls } = await options.withClient(async (client) => {
    let prepared = false
    try {
      await client.query(`${tag} BEGIN`)
      try {
        await client.query(`${tag} SET LOCAL track_functions = 'all'`)
      } catch (cause) {
        throw new Error('EXPLAIN requires SET privilege on track_functions', { cause })
      }
      // Configure before PREPARE so generic planning and execution use identical settings.
      await client.query(
        `${tag} SELECT set_config(key, value, true) FROM jsonb_each_text($1::jsonb)`,
        [JSON.stringify(settings)],
      )
      if (options.setupSql) await client.query(`${tag} ${options.setupSql}`)
      await client.query(`${tag} PREPARE ${preparedName} AS ${cleanText}`)
      prepared = true
      const argumentSql = await buildPreparedArgumentSql(client, preparedName, values, tag)
      const explainText = buildExplainPreparedStatementText(
        preparedName,
        argumentSql,
        options.planOnly,
      )
      const before = await readTransactionFunctionCalls(client, tag)
      const queryResult = await client.query(explainText)
      const calls = functionCallsSince(before, await readTransactionFunctionCalls(client, tag))
      await client.query(`${tag} DEALLOCATE ${preparedName}`)
      prepared = false
      await client.query(`${tag} ROLLBACK`)
      return { rows: queryResult.rows, functionCalls: calls }
    } catch (error) {
      await client.query(`${tag} ROLLBACK`).catch(onCleanupError)
      if (prepared) await client.query(`${tag} DEALLOCATE ${preparedName}`).catch(onCleanupError)
      throw error
    }
  })

  const plan = rows[0]?.['QUERY PLAN'] ?? rows[0]
  const planData = (Array.isArray(plan) ? plan[0] : plan) as Record<string, number> | undefined
  return {
    name,
    query_text: text,
    plan: planData,
    execution_time_ms: planData?.['Execution Time'] ?? 0,
    planning_time_ms: planData?.['Planning Time'] ?? 0,
    timestamp: new Date().toISOString(),
    jit_mode: jit,
    plan_cache_mode: planCacheMode,
    function_calls: functionCalls,
  }
}
