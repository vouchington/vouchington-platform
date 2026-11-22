import type { ExplainResult } from './types.mts'

export function result(plan: unknown, extra: Partial<ExplainResult> = {}): ExplainResult {
  return {
    name: 'q',
    query_text: 'SELECT 1',
    plan,
    execution_time_ms: 10,
    planning_time_ms: 1,
    timestamp: '2026-01-01T00:00:00.000Z',
    ...extra,
  }
}
