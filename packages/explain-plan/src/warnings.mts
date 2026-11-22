import { collectNodes, hasLaunchedParallelWorkers, type NodeStats } from './node-stats.mts'
import type { ExplainResult, FunctionCall } from './types.mts'

export interface PlanThresholds {
  /** Shared blocks (hit + read) on one relation-bearing node. Default 10,000. */
  highSharedBlocks: number
  /** Exclusive WAL bytes on one node, or in total. Default 10 MiB. */
  highWalBytes: number
  /** Plan-to-actual row ratio, either direction, that counts as a mismatch. Default 10. */
  estimateMismatchRatio: number
  /** Mismatches reported per query, worst first. Default 3. */
  maxEstimateMismatches: number
  /** An Append with more children than this is reported. Default 2. */
  appendChildren: number
  /** Planning time over execution time. Default 0.5. */
  planningRatio: number
  /** Execution time below which the planning ratio is ignored. Default 2 ms. */
  planningRatioMinExecutionMs: number
  /** Calls to one function at which it is reported. Default 50. */
  functionCalls: number
}

export const DEFAULT_THRESHOLDS: PlanThresholds = {
  highSharedBlocks: 10_000,
  highWalBytes: 10 * 1024 * 1024,
  estimateMismatchRatio: 10,
  maxEstimateMismatches: 3,
  appendChildren: 2,
  planningRatio: 0.5,
  planningRatioMinExecutionMs: 2,
  functionCalls: 50,
}

export interface AnalyzeOptions {
  /** Relations whose sequential scans are reported, by resolved (parent) name. */
  largeTables: ReadonlySet<string>
  /** Maps a partition name to the name listed in `largeTables`. Defaults to identity. */
  resolveRelation?: (relationName: string) => string
  thresholds?: Partial<PlanThresholds>
}

export interface QueryWarnings {
  seqScans: { relationName: string; actualRows: number; scannedRows: number }[]
  estimateMismatches: {
    nodeType: string
    relationName: string
    planRows: number
    actualRows: number
    ratio: number
  }[]
  costliestNode: NodeStats | undefined
  appendOverhead: { nodeType: string; childCount: number }[]
  highPlanningRatio: boolean
  highSharedBuffers: NodeStats[]
  resourcePressure: NodeStats[]
}

export function resolveThresholds(overrides?: Partial<PlanThresholds>): PlanThresholds {
  return { ...DEFAULT_THRESHOLDS, ...overrides }
}

export function isLargeTable(relationName: string, options: AnalyzeOptions): boolean {
  return options.largeTables.has((options.resolveRelation ?? ((name) => name))(relationName))
}

/** Sorted, deduplicated large relations that were sequentially scanned. */
export function getLargeTableSeqScanRelations(
  result: ExplainResult,
  options: AnalyzeOptions,
): string[] {
  const resolve = options.resolveRelation ?? ((name) => name)
  return [
    ...new Set(analyzeResult(result, options).seqScans.map((scan) => resolve(scan.relationName))),
  ].toSorted()
}

export function hasResourcePressure(node: NodeStats, highWalBytes: number): boolean {
  return (
    node.tempReadBlocks > 0 ||
    node.tempWrittenBlocks > 0 ||
    node.diskSpill ||
    node.hashBatches > 1 ||
    node.walBytes >= highWalBytes
  )
}

export function analyzeResult(result: ExplainResult, options: AnalyzeOptions): QueryWarnings {
  const limits = resolveThresholds(options.thresholds)
  const nodes = collectNodes(result.plan)

  const seqScans = nodes.flatMap((n) => {
    if (!(n.seqScan && n.relationName && isLargeTable(n.relationName, options))) return []
    const actualRows = Math.round(n.actualRows * n.actualLoops)
    const scannedRows = Math.round((n.actualRows + n.rowsRemovedByFilter) * n.actualLoops)
    return scannedRows > 0 ? [{ relationName: n.relationName, actualRows, scannedRows }] : []
  })

  const estimateMismatches = nodes
    .flatMap((n) => {
      if (n.planRows <= 0 || n.actualRows <= 0) return []
      const ratio = Math.max(n.planRows / n.actualRows, n.actualRows / n.planRows)
      return ratio > limits.estimateMismatchRatio
        ? [
            {
              nodeType: n.nodeType,
              relationName: n.relationName ?? 'unknown',
              planRows: n.planRows,
              actualRows: n.actualRows,
              ratio,
            },
          ]
        : []
    })
    .toSorted((a, b) => b.ratio - a.ratio)
    .slice(0, limits.maxEstimateMismatches)

  const costliestNode = nodes.reduce<NodeStats | undefined>(
    (max, n) => (max == null || n.cost > max.cost ? n : max),
    undefined,
  )

  const appendOverhead = nodes.flatMap((n) =>
    n.nodeType === 'Append' && n.childCount > limits.appendChildren
      ? [{ nodeType: n.nodeType, childCount: n.childCount }]
      : [],
  )

  const highPlanningRatio =
    result.execution_time_ms > limits.planningRatioMinExecutionMs &&
    result.planning_time_ms / result.execution_time_ms > limits.planningRatio

  const highSharedBuffers = nodes
    .filter((n) => n.relationName && n.sharedBlocks >= limits.highSharedBlocks)
    .toSorted((a, b) => b.sharedBlocks - a.sharedBlocks)
    .slice(0, 1)

  const resourcePressure = nodes.filter((n) => hasResourcePressure(n, limits.highWalBytes))

  return {
    seqScans,
    estimateMismatches,
    costliestNode,
    appendOverhead,
    highPlanningRatio,
    highSharedBuffers,
    resourcePressure,
  }
}

function busiestFunctionCall(result: ExplainResult): FunctionCall | null {
  return (result.function_calls ?? []).reduce<FunctionCall | null>(
    (busiest, call) => (busiest === null || call.calls > busiest.calls ? call : busiest),
    null,
  )
}

/**
 * Results whose busiest function crossed the call threshold. A parallel plan not captured
 * serially is reported with `busiest: null`, because worker calls are missing from the counts.
 */
export function functionCallReports(
  results: readonly ExplainResult[],
  thresholds?: Partial<PlanThresholds>,
): Array<{ result: ExplainResult; busiest: FunctionCall | null }> {
  const { functionCalls } = resolveThresholds(thresholds)
  return results.flatMap<{ result: ExplainResult; busiest: FunctionCall | null }>((result) => {
    if (!result.function_calls_serial && hasLaunchedParallelWorkers(result.plan))
      return [{ result, busiest: null }]
    const busiest = busiestFunctionCall(result)
    return busiest && busiest.calls >= functionCalls ? [{ result, busiest }] : []
  })
}
