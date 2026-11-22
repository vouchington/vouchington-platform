# @vouchington/explain-plan

Dev-time PostgreSQL plan checking for Node.js 24+. It runs `EXPLAIN (ANALYZE, BUFFERS, WAL,
FORMAT JSON)` through an injected connection, walks the plan, and turns it into statistics,
warnings, and regression gates. It has no runtime dependencies and knows no table names: every
policy (large tables, partition naming, thresholds, baselines) is an input. Install it as a dev
dependency; do not import it from request-serving code.

## Capture

```ts
import { explainAnalyze } from '@vouchington/explain-plan'

const result = await explainAnalyze({
  withClient: async (run) => {
    const client = await pool.connect()
    try {
      return await run(client)
    } finally {
      client.release()
    }
  },
  name: 'orders-by-customer',
  text: 'SELECT * FROM orders WHERE customer_id = $1',
  values: [42],
  workMem: '32MB',
})
```

Each capture runs in one transaction that is always rolled back, so data-modifying statements
leave nothing behind. The statement is prepared, its parameters are rendered as typed literals
from `pg_prepared_statements`, and `pg_stat_xact_user_functions` deltas are returned as
`function_calls`. Options: `jit` (default `off`), `planCacheMode`, `localSettings`, `workMem`,
`planOnly`, `setupSql`, `statementTag` (comment prefixed to every issued statement), and
`onCleanupError`. `client` needs only `query(text, values?) => Promise<{ rows }>`, which a `pg`
client satisfies.

## Analyze

- `collectNodes(plan)` returns per-node `NodeStats`. Temp blocks and WAL bytes are exclusive to
  the node (Postgres reports them cumulatively); shared buffers stay cumulative.
- `collectPlanNodes`, `processedRows`, `planNodeUsesIndex`, `sequentiallyScanned`, and
  `hasLaunchedParallelWorkers` are raw-node helpers. `createPartitionResolver(parents)` maps
  partition names (`parent`, `parent__x`, `parent_default`) back to a parent.
- `analyzeResult(result, { largeTables, resolveRelation?, thresholds? })` reports large
  sequential scans, row-estimate mismatches, wide `Append` nodes, high planning ratio, heavy
  shared-buffer use, and resource pressure. `thresholds` overrides any field of
  `DEFAULT_THRESHOLDS`.
- `functionCallReports(results, thresholds?)` finds functions called often, and flags parallel
  plans whose counts are incomplete.
- `getResourcePressureFingerprints(result)` yields stable `Node:relation:kind` strings;
  `findPressureRegressions` and `assertNoPressureRegressions` compare two captures against a
  baseline, requiring WAL pressure to repeat because checkpoint full-page images make it noisy.
- `formatMarkdownReport(results, options)` renders a summary table and warning details.

## Release

The package is at `0.0.0`. A maintainer must bootstrap-publish `0.0.0` and configure npm trusted
publishing before the first release.
