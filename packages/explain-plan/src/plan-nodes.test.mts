import { describe, expect, it } from 'vitest'
import { collectNodes, hasLaunchedParallelWorkers } from './node-stats.mts'
import {
  baseRelationName,
  collectPlanNodes,
  createPartitionResolver,
  planNodeUsesIndex,
  processedRows,
  sequentiallyScanned,
} from './plan-nodes.mts'

describe('collectPlanNodes', () => {
  it('walks wrappers and children and ignores non-objects', () => {
    const plan = {
      Plan: { 'Node Type': 'Append', Plans: [{ 'Node Type': 'Seq Scan' }, 'x', null] },
    }
    expect(collectPlanNodes(plan).map((n) => n['Node Type'])).toEqual(['Append', 'Seq Scan'])
    expect(collectPlanNodes(null)).toEqual([])
    expect(collectPlanNodes([])).toEqual([])
    expect(collectPlanNodes({ Plans: 'nope' })).toEqual([])
  })
})

describe('plan node helpers', () => {
  it('counts processed rows across loops with defaults', () => {
    expect(processedRows({})).toBe(0)
    expect(
      processedRows({
        'Actual Rows': 2,
        'Rows Removed by Filter': 3,
        'Rows Removed by Index Recheck': 1,
        'Actual Loops': 2,
      }),
    ).toBe(12)
  })

  it('matches index names and conflict arbiters', () => {
    expect(planNodeUsesIndex({ 'Index Name': 'i' }, 'i')).toBe(true)
    expect(planNodeUsesIndex({ 'Conflict Arbiter Indexes': ['a', 'i'] }, 'i')).toBe(true)
    expect(planNodeUsesIndex({ 'Conflict Arbiter Indexes': 'i' }, 'i')).toBe(false)
    expect(planNodeUsesIndex({}, 'i')).toBe(false)
  })

  it('resolves partitions to the longest parent', () => {
    const resolve = createPartitionResolver(['events', 'events_archive'])
    expect(resolve('events')).toBe('events')
    expect(resolve('events__2026')).toBe('events')
    expect(resolve('events_default')).toBe('events')
    expect(resolve('events_archive__2026')).toBe('events_archive')
    expect(resolve('other')).toBe('other')
    expect(createPartitionResolver(['t'], ['-'])('t-1')).toBe('t')
  })

  it('names base relations with and without a resolver', () => {
    expect(baseRelationName({ 'Relation Name': 'events__1' })).toBe('events__1')
    expect(baseRelationName({}, createPartitionResolver([]))).toBe('')
    expect(
      baseRelationName({ 'Relation Name': 'events__1' }, createPartitionResolver(['events'])),
    ).toBe('events')
  })

  it('detects only executed sequential scans', () => {
    const nodes = [
      { 'Node Type': 'Seq Scan', 'Relation Name': 'events__1', 'Actual Rows': 0 },
      { 'Node Type': 'Seq Scan', 'Relation Name': 'events__2', 'Rows Removed by Filter': 4 },
      { 'Node Type': 'Index Scan', 'Relation Name': 'users', 'Actual Rows': 9 },
    ]
    const resolve = createPartitionResolver(['events'])
    expect(sequentiallyScanned(nodes, 'events', resolve)).toBe(true)
    expect(sequentiallyScanned(nodes.slice(0, 1), 'events', resolve)).toBe(false)
    expect(sequentiallyScanned(nodes, 'users')).toBe(false)
    expect(sequentiallyScanned(nodes, 'events__2')).toBe(true)
  })
})

describe('collectNodes', () => {
  it('makes temp and WAL counters exclusive and keeps buffers cumulative', () => {
    const plan = {
      Plan: {
        'Node Type': 'Sort',
        'Temp Read Blocks': 10,
        'Temp Written Blocks': 10,
        'WAL Bytes': 100,
        'Shared Hit Blocks': 7,
        'Shared Read Blocks': 3,
        'Sort Space Type': 'Disk',
        Plans: [
          {
            'Node Type': 'Seq Scan',
            'Relation Name': 'events',
            'Temp Read Blocks': 10,
            'WAL Bytes': 150,
            'Actual Rows': 5,
            'Plan Rows': 4,
            'Total Cost': 9,
            'Actual Loops': 3,
            'Hash Batches': 4,
          },
        ],
      },
    }
    const [sort, scan] = collectNodes(plan)
    expect(sort).toMatchObject({
      tempReadBlocks: 0,
      tempWrittenBlocks: 10,
      walBytes: 0,
      sharedBlocks: 10,
      diskSpill: true,
      childCount: 1,
      hashBatches: 1,
      actualLoops: 1,
      seqScan: false,
    })
    expect(scan).toMatchObject({
      seqScan: true,
      relationName: 'events',
      tempReadBlocks: 10,
      walBytes: 150,
      actualLoops: 3,
      hashBatches: 4,
      cost: 9,
    })
    expect(collectNodes('x')).toEqual([])
    expect(collectNodes({ Plan: { 'Node Type': 'Result' }, Plans: [1] })).toHaveLength(1)
  })

  it('detects launched parallel workers', () => {
    const gather = (n: number) => ({ 'Node Type': 'Gather', 'Workers Launched': n })
    expect(hasLaunchedParallelWorkers(gather(2))).toBe(true)
    expect(hasLaunchedParallelWorkers({ 'Node Type': 'Gather Merge', 'Workers Launched': 1 })).toBe(
      true,
    )
    expect(hasLaunchedParallelWorkers(gather(0))).toBe(false)
    expect(hasLaunchedParallelWorkers({ 'Node Type': 'Seq Scan' })).toBe(false)
  })
})
