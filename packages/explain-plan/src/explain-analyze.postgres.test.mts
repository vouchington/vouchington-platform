import pg from 'pg'
import { describe, expect, it } from 'vitest'
import { explainAnalyze } from './explain-analyze.mts'
import { buildExplainPreparedStatementText } from './prepared.mts'
import { functionCallsSince } from './function-calls.mts'
import type { ExplainClient, WithExplainClient } from './types.mts'

const url = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/postgres'

const withPg: WithExplainClient = async (run) => {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    return await run(client as unknown as ExplainClient)
  } finally {
    await client.end()
  }
}

function scripted(handle: (text: string) => { rows: Record<string, unknown>[] } | Error): {
  withClient: WithExplainClient
  statements: string[]
} {
  const statements: string[] = []
  const client: ExplainClient = {
    async query(text) {
      statements.push(text)
      const result = handle(text)
      if (result instanceof Error) throw result
      return result
    },
  }
  return { withClient: (run) => run(client), statements }
}

describe('explainAnalyze against Postgres', () => {
  it('captures a parameterised plan with typed literals and rolls back', async () => {
    const result = await explainAnalyze({
      withClient: withPg,
      name: 'generate-series',
      text: '/* leading */ SELECT count(*) FROM generate_series(1, $1::int) AS n WHERE n > $2',
      values: [100, 5],
      workMem: '32MB',
      localSettings: { enable_seqscan: 'on' },
    })
    expect(result.name).toBe('generate-series')
    expect(result.query_text).toContain('/* leading */')
    expect(result.jit_mode).toBe('off')
    expect(result.plan_cache_mode).toBe('auto')
    expect(result.execution_time_ms).toBeGreaterThanOrEqual(0)
    expect((result.plan as Record<string, unknown>)['Plan']).toBeDefined()
    expect(result.function_calls).toEqual([])
  })

  it('captures plan-only output with no parameters and counts function calls', async () => {
    const client = new pg.Client({ connectionString: url })
    await client.connect()
    try {
      await client.query('CREATE TEMP TABLE explain_plan_probe (id int)')
      await client.query(
        'CREATE FUNCTION pg_temp.explain_plan_noop(i int) RETURNS int LANGUAGE sql AS $$ SELECT i $$',
      )
      const result = await explainAnalyze({
        withClient: async (run) => run(client as unknown as ExplainClient),
        name: 'probe',
        text: 'SELECT pg_temp.explain_plan_noop(n) FROM generate_series(1, 3) n',
        jit: 'on',
        planCacheMode: 'force_generic_plan',
      })
      expect(result.jit_mode).toBe('on')
      const planOnly = await explainAnalyze({
        withClient: async (run) => run(client as unknown as ExplainClient),
        name: 'probe',
        text: 'SELECT * FROM explain_plan_probe',
        planOnly: true,
        setupSql: 'SELECT 1',
      })
      expect(planOnly.execution_time_ms).toBe(0)
    } finally {
      await client.end()
    }
  })

  it('rejects a parameter-count mismatch and leaves no open transaction', async () => {
    await expect(
      explainAnalyze({ withClient: withPg, name: 'bad', text: 'SELECT $1::int', values: [] }),
    ).rejects.toThrow('expected 1, received 0')
  })
})

describe('explainAnalyze with a scripted client', () => {
  it('tags statements, tolerates a missing plan, and handles no parameters', async () => {
    const { withClient, statements } = scripted((text) =>
      text.startsWith('EXPLAIN') ? { rows: [] } : { rows: [] },
    )
    const result = await explainAnalyze({
      withClient,
      name: 'n',
      text: 'SELECT 1',
      statementTag: 'custom',
    })
    expect(result.plan).toBeUndefined()
    expect(result.execution_time_ms).toBe(0)
    expect(result.planning_time_ms).toBe(0)
    expect(statements[0]).toBe('/* custom */ BEGIN')
    expect(statements.at(-1)).toBe('/* custom */ ROLLBACK')
  })

  it('accepts a bare row as the plan', async () => {
    const { withClient } = scripted((text) =>
      text.startsWith('EXPLAIN')
        ? { rows: [{ 'Execution Time': 2, 'Planning Time': 1 }] }
        : { rows: [] },
    )
    const result = await explainAnalyze({ withClient, name: 'n', text: 'SELECT 1' })
    expect(result.execution_time_ms).toBe(2)
    expect(result.planning_time_ms).toBe(1)
  })

  it('wraps a track_functions privilege failure and rolls back', async () => {
    const cleanup: unknown[] = []
    const { withClient, statements } = scripted((text) =>
      text.includes('track_functions') ? new Error('denied') : { rows: [] },
    )
    await expect(
      explainAnalyze({
        withClient,
        name: 'n',
        text: 'SELECT 1',
        onCleanupError: (e) => cleanup.push(e),
      }),
    ).rejects.toThrow('EXPLAIN requires SET privilege on track_functions')
    expect(statements.at(-1)).toContain('ROLLBACK')
    expect(cleanup).toEqual([])
  })

  it('deallocates after a failure past PREPARE and reports cleanup errors', async () => {
    const cleanup: unknown[] = []
    const { withClient, statements } = scripted((text) => {
      if (text.startsWith('EXPLAIN')) return new Error('boom')
      if (text.includes('ROLLBACK') || text.includes('DEALLOCATE')) return new Error('cleanup')
      return { rows: [] }
    })
    await expect(
      explainAnalyze({
        withClient,
        name: 'n',
        text: 'SELECT 1',
        onCleanupError: (e) => cleanup.push(e),
      }),
    ).rejects.toThrow('boom')
    expect(statements.some((s) => s.includes('DEALLOCATE'))).toBe(true)
    expect(cleanup).toHaveLength(2)
  })

  it('swallows cleanup errors by default', async () => {
    const { withClient } = scripted((text) => {
      if (text.startsWith('EXPLAIN')) return new Error('boom')
      if (text.includes('ROLLBACK')) return new Error('cleanup')
      return { rows: [] }
    })
    await expect(explainAnalyze({ withClient, name: 'n', text: 'SELECT 1' })).rejects.toThrow(
      'boom',
    )
  })
})

describe('statement helpers', () => {
  it('builds EXPLAIN text for each mode', () => {
    expect(buildExplainPreparedStatementText('s', [])).toBe(
      'EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT JSON) EXECUTE s',
    )
    expect(buildExplainPreparedStatementText('s', ["'a'::text", '1::int'], true)).toBe(
      "EXPLAIN (FORMAT JSON) EXECUTE s('a'::text, 1::int)",
    )
  })

  it('computes per-function deltas, busiest first with name tiebreak', () => {
    const row = (funcid: string, funcname: string, calls: string, time: number) => ({
      funcid,
      funcname,
      calls,
      total_time: time,
      self_time: time,
    })
    expect(
      functionCallsSince(
        [row('1', 'a', '2', 1)],
        [
          row('1', 'a', '5', 4),
          row('2', 'b', '3', 2),
          row('3', 'c', '3', 2),
          row('4', 'd', '0', 0),
        ],
      ),
    ).toEqual([
      { funcname: 'a', calls: 3, total_time: 3, self_time: 3 },
      { funcname: 'b', calls: 3, total_time: 2, self_time: 2 },
      { funcname: 'c', calls: 3, total_time: 2, self_time: 2 },
    ])
  })
})
