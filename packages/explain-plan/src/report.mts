import type { NodeStats } from './node-stats.mts'
import type { ExplainResult } from './types.mts'
import { analyzeResult, functionCallReports, type AnalyzeOptions } from './warnings.mts'

export interface ReportOptions extends AnalyzeOptions {
  /** Where the results came from; printed in the footer when set. */
  source?: string
  /** Rewrites a result name for display. */
  displayName?: (name: string) => string
  /** Extra table columns, inserted before the timings. */
  columns?: readonly { header: string; value: (result: ExplainResult) => string }[]
}

const pressureLabel = (n: NodeStats) => `${n.nodeType} on ${n.relationName ?? 'unnamed'}`
const ms = (value: number) => value.toFixed(1)

/** Renders a markdown summary table and warning details; slowest queries first. */
export function formatMarkdownReport(
  results: readonly ExplainResult[],
  options: ReportOptions,
): string {
  const sorted = results.toSorted((a, b) => b.execution_time_ms - a.execution_time_ms)
  const columns = options.columns ?? []
  const name = options.displayName ?? ((value) => value)
  const analyzed = sorted.map((result) => ({ result, w: analyzeResult(result, options) }))
  const lines: string[] = ['## EXPLAIN ANALYZE Results', '']
  lines.push(
    `| Query | ${columns.map((c) => `${c.header} | `).join('')}Exec (ms) | Plan (ms) | Warnings |`,
    `|-------|${columns.map(() => '------|').join('')}----------:|----------:|----------|`,
  )

  for (const { result: r, w } of analyzed) {
    const parts: string[] = []
    if (w.seqScans.length > 0)
      parts.push(`Seq scan: ${w.seqScans.map((s) => s.relationName).join(', ')}`)
    const worst = w.estimateMismatches[0]
    if (worst) parts.push(`Est. mismatch ${worst.ratio.toFixed(0)}x on ${worst.relationName}`)
    if (w.appendOverhead.length > 0)
      parts.push(
        `Append overhead: ${w.appendOverhead.map((a) => `${a.childCount} children`).join(', ')}`,
      )
    if (w.highPlanningRatio)
      parts.push(`High plan ratio: ${ms(r.planning_time_ms)}ms/${ms(r.execution_time_ms)}ms`)
    const pressure = w.resourcePressure.map(pressureLabel)
    if (w.aggregateWalBytes !== undefined) pressure.push('query-wide WAL')
    if (pressure.length > 0) parts.push(`Resource pressure: ${pressure.join(', ')}`)
    const buffers = w.highSharedBuffers[0]
    if (buffers)
      parts.push(
        `High buffers: ${buffers.sharedBlocks} shared on ${buffers.relationName as string}`,
      )
    const extra = columns.map((c) => ` ${c.value(r)} |`).join('')
    lines.push(
      `| ${name(r.name)} |${extra} ${ms(r.execution_time_ms)} | ${ms(r.planning_time_ms)} | ${parts.join('; ') || '-'} |`,
    )
  }

  const callReports = functionCallReports(sorted, options.thresholds)
  if (callReports.length > 0) {
    lines.push('', '### Function-call findings', '')
    for (const { result, busiest } of callReports) {
      const detail = busiest
        ? `${busiest.funcname} called ${busiest.calls} times`
        : 'incomplete: parallel workers omit calls from leader-local counts'
      lines.push(`- ${result.name}: ${detail}`)
    }
  }

  const flagged = analyzed.filter(
    ({ w }) =>
      w.seqScans.length + w.estimateMismatches.length + w.appendOverhead.length > 0 ||
      w.highPlanningRatio ||
      w.highSharedBuffers.length > 0 ||
      w.resourcePressure.length > 0 ||
      w.aggregateWalBytes !== undefined,
  )
  if (flagged.length > 0) {
    lines.push('', '### Warnings', '')
    for (const { result: r, w } of flagged) {
      lines.push(
        `**${r.name}** (exec ${ms(r.execution_time_ms)}ms, plan ${ms(r.planning_time_ms)}ms)`,
        '',
      )
      for (const s of w.seqScans)
        lines.push(
          `- Seq scan on \`${s.relationName}\` (${s.scannedRows} rows scanned, ${s.actualRows} rows output)`,
        )
      for (const e of w.estimateMismatches)
        lines.push(
          `- Row estimate mismatch: ${e.nodeType} on \`${e.relationName}\` — estimated ${e.planRows}, actual ${e.actualRows} (${e.ratio.toFixed(0)}x)`,
        )
      for (const a of w.appendOverhead)
        lines.push(`- Append node overhead: ${a.childCount} children (${a.nodeType})`)
      if (w.highPlanningRatio)
        lines.push(
          `- High planning:execution ratio: ${ms(r.planning_time_ms)}ms planning vs ${ms(r.execution_time_ms)}ms execution`,
        )
      for (const n of w.resourcePressure)
        lines.push(
          `- Resource pressure: ${pressureLabel(n)} (${n.tempReadBlocks} temp blocks read, ${n.tempWrittenBlocks} written, ${n.walBytes} WAL bytes${n.diskSpill ? ', disk sort' : ''}${n.hashBatches > 1 ? `, ${n.hashBatches} hash batches` : ''})`,
        )
      if (w.aggregateWalBytes !== undefined)
        lines.push(
          `- Resource pressure: query-wide WAL of ${w.aggregateWalBytes} bytes across several nodes`,
        )
      for (const b of w.highSharedBuffers)
        lines.push(
          `- High shared buffers: ${b.nodeType} on \`${b.relationName as string}\` touched ${b.sharedBlocks} shared blocks (${b.sharedHitBlocks} hit, ${b.sharedReadBlocks} read, ${b.sharedDirtiedBlocks} dirtied, ${b.sharedWrittenBlocks} written)`,
        )
      lines.push('')
    }
  }

  lines.push(
    '',
    `*${results.length} queries analyzed${options.source ? ` from ${options.source}` : ''}*`,
  )
  return lines.join('\n')
}
