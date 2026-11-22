import { collectNodes } from './node-stats.mts'
import type { ExplainResult } from './types.mts'
import { resolveThresholds, type PlanThresholds } from './warnings.mts'

/** Allowed fingerprints per result identity. */
export type PressureBaseline = Readonly<Record<string, readonly string[]>>

export function getExplainResultIdentity(result: ExplainResult): string {
  return [
    result.scenario_id ?? 'unscoped',
    result.capture_index ?? 0,
    result.name,
    result.plan_cache_mode ?? 'auto',
  ].join('|')
}

// The root node's WAL Bytes is cumulative over the whole query, so reading it needs no
// subtraction.
function getTotalWalBytes(plan: unknown): number {
  if (plan == null || typeof plan !== 'object' || Array.isArray(plan)) return 0
  const wrapper = plan as Record<string, unknown>
  const rootNode = (wrapper['Plan'] ?? wrapper) as Record<string, unknown>
  return Number(rootNode['WAL Bytes'] ?? 0)
}

/**
 * Stable `NodeType:relation:kind` strings for temp I/O, disk sorts, multi-batch hashes, and WAL
 * spikes, plus `query:wal-aggregate` when WAL crosses the threshold only in total.
 */
export function getResourcePressureFingerprints(
  result: ExplainResult,
  thresholds?: Partial<PlanThresholds>,
): string[] {
  const { highWalBytes } = resolveThresholds(thresholds)
  const nodes = collectNodes(result.plan)
  const fingerprints = nodes.flatMap((node) => {
    const identity = `${node.nodeType}:${node.relationName ?? '-'}`
    const found: string[] = []
    if (node.tempReadBlocks > 0) found.push(`${identity}:temp-read`)
    if (node.tempWrittenBlocks > 0) found.push(`${identity}:temp-written`)
    if (node.diskSpill) found.push(`${identity}:disk-spill`)
    if (node.hashBatches > 1) found.push(`${identity}:hash-batches`)
    if (node.walBytes >= highWalBytes) found.push(`${identity}:wal`)
    return found
  })

  // Sibling modifying nodes can sum past the threshold at their ancestor while no node's
  // exclusive share does. Add the aggregate only then, so one spike reports once.
  const anyNodeCrossed = nodes.some((n) => n.walBytes >= highWalBytes)
  if (!anyNodeCrossed && getTotalWalBytes(result.plan) >= highWalBytes) {
    fingerprints.push('query:wal-aggregate')
  }
  return fingerprints.toSorted()
}

// WAL bytes include checkpoint full-page images, so a node WAL fingerprint and
// `query:wal-aggregate` are one query-wide threshold that can trade places between captures.
export function isCheckpointSensitiveWalFingerprint(fingerprint: string): boolean {
  return fingerprint === 'query:wal-aggregate' || fingerprint.endsWith(':wal')
}

/** A missing repeat is fail-closed; a different node does not confirm a node fingerprint. */
export function confirmsRepeatedWalFingerprint(
  fingerprint: string,
  repeated: ReadonlySet<string> | undefined,
): boolean {
  if (repeated === undefined || repeated.has(fingerprint)) return true
  return fingerprint === 'query:wal-aggregate'
    ? [...repeated].some((entry) => entry.endsWith(':wal'))
    : repeated.has('query:wal-aggregate')
}

/**
 * `identity=fingerprint` strings for pressure not in `baseline`. WAL fingerprints count only when
 * the repeated capture of the same identity confirms them; the others use the first capture.
 */
export function findPressureRegressions(
  results: readonly ExplainResult[],
  repeatedResults: readonly ExplainResult[],
  baseline: PressureBaseline = {},
  thresholds?: Partial<PlanThresholds>,
): string[] {
  const repeatedWalByIdentity = new Map(
    repeatedResults.map((result) => [
      getExplainResultIdentity(result),
      new Set(
        getResourcePressureFingerprints(result, thresholds).filter(
          isCheckpointSensitiveWalFingerprint,
        ),
      ),
    ]),
  )
  return results.flatMap((result) => {
    const identity = getExplainResultIdentity(result)
    const allowed = new Set(baseline[identity] ?? [])
    const repeatedWal = repeatedWalByIdentity.get(identity)
    return getResourcePressureFingerprints(result, thresholds)
      .filter((fingerprint) => !allowed.has(fingerprint))
      .filter(
        (fingerprint) =>
          !isCheckpointSensitiveWalFingerprint(fingerprint) ||
          confirmsRepeatedWalFingerprint(fingerprint, repeatedWal),
      )
      .map((fingerprint) => `${identity}=${fingerprint}`)
  })
}

export function assertNoPressureRegressions(
  results: readonly ExplainResult[],
  repeatedResults: readonly ExplainResult[],
  baseline?: PressureBaseline,
  thresholds?: Partial<PlanThresholds>,
): void {
  const regressions = findPressureRegressions(results, repeatedResults, baseline, thresholds)
  if (regressions.length > 0) {
    throw new Error(
      `EXPLAIN found new disallowed temp, spill, hash-batch, or WAL pressure: ${regressions.join(', ')}`,
    )
  }
}
