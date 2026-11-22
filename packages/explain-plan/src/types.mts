/** The minimal query surface the package needs; a `pg` client satisfies it. */
export interface ExplainClient {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
}

/** Runs `run` on one dedicated connection and releases it afterwards. */
export type WithExplainClient = <T>(run: (client: ExplainClient) => Promise<T>) => Promise<T>

export type ExplainPlanCacheMode = 'auto' | 'force_custom_plan' | 'force_generic_plan'

export interface FunctionCall {
  funcname: string
  calls: number
  total_time: number
  self_time: number
}

export interface ExplainResult {
  name: string
  query_text: string
  plan: unknown
  execution_time_ms: number
  planning_time_ms: number
  timestamp: string
  jit_mode?: 'on' | 'off'
  plan_cache_mode?: ExplainPlanCacheMode
  scenario_id?: string
  capture_index?: number
  function_calls?: FunctionCall[]
  function_calls_serial?: boolean
}
