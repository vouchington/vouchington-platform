import type { ExplainClient, FunctionCall } from './types.mts'

export interface TrackedFunctionRow {
  funcid: string
  funcname: string
  calls: string
  total_time: number
  self_time: number
}

/** Per-function deltas between two `pg_stat_xact_user_functions` reads, busiest first. */
export function functionCallsSince(
  before: readonly TrackedFunctionRow[],
  after: readonly TrackedFunctionRow[],
): FunctionCall[] {
  const baseline = new Map(before.map((row) => [row.funcid, row]))
  return after
    .flatMap((row) => {
      const previous = baseline.get(row.funcid)
      const calls = Number(row.calls) - Number(previous?.calls ?? 0)
      if (calls <= 0) return []
      return [
        {
          funcname: row.funcname,
          calls,
          total_time: row.total_time - (previous?.total_time ?? 0),
          self_time: row.self_time - (previous?.self_time ?? 0),
        },
      ]
    })
    .toSorted((a, b) => b.calls - a.calls || a.funcname.localeCompare(b.funcname))
}

export async function readTransactionFunctionCalls(
  client: ExplainClient,
  tag: string,
): Promise<TrackedFunctionRow[]> {
  const { rows } = await client.query(`${tag}
    SELECT funcid::text AS funcid, funcname::text AS funcname, calls,
           total_time, self_time
    FROM pg_stat_xact_user_functions`)
  return rows as unknown as TrackedFunctionRow[]
}
