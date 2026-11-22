import { describe, expect, it } from 'vitest'
import { result } from './test-helpers.mts'
import {
  analyzeResult,
  functionCallReports,
  getLargeTableSeqScanRelations,
  isLargeTable,
  type AnalyzeOptions,
} from './warnings.mts'
import { createPartitionResolver } from './plan-nodes.mts'

const options: AnalyzeOptions = {
  largeTables: new Set(['events']),
  resolveRelation: createPartitionResolver(['events']),
}

describe('analyzeResult', () => {
  it('reports large sequential scans by loop-adjusted rows and skips empty ones', () => {
    const plan = {
      Plan: {
        'Node Type': 'Append',
        Plans: [
          {
            'Node Type': 'Seq Scan',
            'Relation Name': 'events__1',
            'Actual Rows': 2,
            'Rows Removed by Filter': 3,
            'Actual Loops': 2,
          },
          { 'Node Type': 'Seq Scan', 'Relation Name': 'events__2', 'Actual Rows': 0 },
          { 'Node Type': 'Seq Scan', 'Relation Name': 'small', 'Actual Rows': 9 },
          { 'Node Type': 'Seq Scan', 'Actual Rows': 9 },
        ],
      },
    }
    expect(analyzeResult(result(plan), options).seqScans).toEqual([
      { relationName: 'events__1', actualRows: 4, scannedRows: 10 },
    ])
    expect(getLargeTableSeqScanRelations(result(plan), options)).toEqual(['events'])
    expect(
      getLargeTableSeqScanRelations(result(plan), { largeTables: new Set(['events__1']) }),
    ).toEqual(['events__1'])
    expect(isLargeTable('events__9', options)).toBe(true)
    expect(isLargeTable('events__9', { largeTables: new Set(['events']) })).toBe(false)
  })

  it('reports the three worst estimate mismatches and ignores zero rows', () => {
    const node = (planRows: number, actualRows: number, relation?: string) => ({
      'Node Type': 'Index Scan',
      'Relation Name': relation,
      'Plan Rows': planRows,
      'Actual Rows': actualRows,
    })
    const plan = {
      'Node Type': 'Nested Loop',
      Plans: [
        node(1, 100, 'a'),
        node(1000, 1, 'b'),
        node(1, 50),
        node(1, 20, 'd'),
        node(0, 5),
        node(5, 5),
      ],
    }
    const { estimateMismatches } = analyzeResult(result(plan), { largeTables: new Set() })
    expect(estimateMismatches.map((m) => m.relationName)).toEqual(['b', 'a', 'unknown'])
    expect(estimateMismatches[0]!.ratio).toBe(1000)
    expect(
      analyzeResult(result(plan), {
        largeTables: new Set(),
        thresholds: { maxEstimateMismatches: 1, estimateMismatchRatio: 2000 },
      }).estimateMismatches,
    ).toEqual([])
  })

  it('finds the costliest node, wide appends, planning ratio, and buffer pressure', () => {
    const plan = {
      'Node Type': 'Append',
      'Total Cost': 5,
      Plans: [
        {
          'Node Type': 'Seq Scan',
          'Relation Name': 'a',
          'Total Cost': 50,
          'Shared Hit Blocks': 9000,
          'Shared Read Blocks': 1000,
        },
        { 'Node Type': 'Seq Scan', 'Relation Name': 'b', 'Shared Hit Blocks': 20000 },
        { 'Node Type': 'Result', 'Shared Hit Blocks': 90000 },
      ],
    }
    const warnings = analyzeResult(
      result(plan, { execution_time_ms: 4, planning_time_ms: 3 }),
      options,
    )
    expect(warnings.costliestNode?.relationName).toBe('a')
    expect(warnings.appendOverhead).toEqual([{ nodeType: 'Append', childCount: 3 }])
    expect(warnings.highPlanningRatio).toBe(true)
    expect(warnings.highSharedBuffers.map((n) => n.relationName)).toEqual(['b'])
    expect(
      analyzeResult(result(plan, { execution_time_ms: 1, planning_time_ms: 3 }), options)
        .highPlanningRatio,
    ).toBe(false)
    expect(
      analyzeResult(result(plan), { ...options, thresholds: { appendChildren: 3 } }).appendOverhead,
    ).toEqual([])
  })

  it('flags resource pressure per node and handles empty plans', () => {
    const plan = {
      'Node Type': 'Sort',
      'Sort Space Type': 'Disk',
      Plans: [
        { 'Node Type': 'Hash', 'Hash Batches': 2 },
        { 'Node Type': 'Result', 'WAL Bytes': 200 },
      ],
    }
    const pressured = analyzeResult(result(plan), {
      largeTables: new Set(),
      thresholds: { highWalBytes: 100 },
    }).resourcePressure
    expect(pressured.map((n) => n.nodeType)).toEqual(['Sort', 'Hash', 'Result'])
    const empty = analyzeResult(result(undefined), options)
    expect(empty.costliestNode).toBeUndefined()
    expect(empty.resourcePressure).toEqual([])
  })
})

describe('functionCallReports', () => {
  const calls = (n: number) => [{ funcname: 'f', calls: n, total_time: 0, self_time: 0 }]
  it('reports busy functions, parallel plans without a serial capture, and skips the rest', () => {
    const parallel = { 'Node Type': 'Gather', 'Workers Launched': 2 }
    const busy = result(
      {},
      { name: 'busy', function_calls: [...calls(50), ...calls(60), ...calls(55)] },
    )
    const quiet = result({}, { name: 'quiet', function_calls: calls(49) })
    const none = result({}, { name: 'none' })
    const incomplete = result(parallel, { name: 'incomplete', function_calls: calls(500) })
    const serial = result(parallel, {
      name: 'serial',
      function_calls: calls(500),
      function_calls_serial: true,
    })
    const reports = functionCallReports([busy, quiet, none, incomplete, serial])
    expect(reports.map((r) => [r.result.name, r.busiest?.calls ?? null])).toEqual([
      ['busy', 60],
      ['incomplete', null],
      ['serial', 500],
    ])
    expect(functionCallReports([quiet], { functionCalls: 10 })).toHaveLength(1)
  })
})
