import { describe, expect, it } from 'vitest'
import {
  assertNoPressureRegressions,
  confirmsRepeatedWalFingerprint,
  findPressureRegressions,
  getExplainResultIdentity,
  getResourcePressureFingerprints,
  isCheckpointSensitiveWalFingerprint,
} from './pressure.mts'
import { result } from './test-helpers.mts'

const spill = {
  Plan: {
    'Node Type': 'Sort',
    'Sort Space Type': 'Disk',
    'Temp Read Blocks': 2,
    'Temp Written Blocks': 2,
    Plans: [{ 'Node Type': 'Hash', 'Relation Name': 'events', 'Hash Batches': 4 }],
  },
}
const wal = (bytes: number) => ({
  Plan: { 'Node Type': 'ModifyTable', 'Relation Name': 't', 'WAL Bytes': bytes },
})
const aggregate = {
  Plan: {
    'Node Type': 'Result',
    'WAL Bytes': 150,
    Plans: [
      { 'Node Type': 'ModifyTable', 'Relation Name': 'a', 'WAL Bytes': 75 },
      { 'Node Type': 'ModifyTable', 'Relation Name': 'b', 'WAL Bytes': 75 },
    ],
  },
}
const thresholds = { highWalBytes: 100 }

describe('getResourcePressureFingerprints', () => {
  it('lists sorted per-node fingerprints', () => {
    expect(getResourcePressureFingerprints(result(spill))).toEqual([
      'Hash:events:hash-batches',
      'Sort:-:disk-spill',
      'Sort:-:temp-read',
      'Sort:-:temp-written',
    ])
  })

  it('reports a WAL spike once, per node or in aggregate', () => {
    expect(getResourcePressureFingerprints(result(wal(100)), thresholds)).toEqual([
      'ModifyTable:t:wal',
    ])
    expect(getResourcePressureFingerprints(result(aggregate), thresholds)).toEqual([
      'query:wal-aggregate',
    ])
    expect(getResourcePressureFingerprints(result(wal(99)), thresholds)).toEqual([])
    expect(getResourcePressureFingerprints(result(wal(10 * 1024 * 1024)))).toHaveLength(1)
    expect(
      getResourcePressureFingerprints(
        result({ 'Node Type': 'Result', 'WAL Bytes': 500 }),
        thresholds,
      ),
    ).toEqual(['Result:-:wal'])
    expect(
      getResourcePressureFingerprints(
        result({ 'Node Type': 'Result', 'WAL Bytes': 50 }),
        thresholds,
      ),
    ).toEqual([])
    expect(getResourcePressureFingerprints(result(null), thresholds)).toEqual([])
    expect(getResourcePressureFingerprints(result([]), thresholds)).toEqual([])
  })
})

describe('WAL confirmation', () => {
  it('classifies checkpoint-sensitive fingerprints', () => {
    expect(isCheckpointSensitiveWalFingerprint('query:wal-aggregate')).toBe(true)
    expect(isCheckpointSensitiveWalFingerprint('A:b:wal')).toBe(true)
    expect(isCheckpointSensitiveWalFingerprint('A:b:disk-spill')).toBe(false)
  })

  it('fails closed without a repeat and lets aggregate and node forms trade places', () => {
    expect(confirmsRepeatedWalFingerprint('A:b:wal', undefined)).toBe(true)
    expect(confirmsRepeatedWalFingerprint('A:b:wal', new Set(['A:b:wal']))).toBe(true)
    expect(confirmsRepeatedWalFingerprint('A:b:wal', new Set(['C:d:wal']))).toBe(false)
    expect(confirmsRepeatedWalFingerprint('A:b:wal', new Set(['query:wal-aggregate']))).toBe(true)
    expect(confirmsRepeatedWalFingerprint('query:wal-aggregate', new Set(['C:d:wal']))).toBe(true)
    expect(confirmsRepeatedWalFingerprint('query:wal-aggregate', new Set())).toBe(false)
  })
})

describe('regressions', () => {
  it('builds a stable identity with defaults', () => {
    expect(getExplainResultIdentity(result({}))).toBe('unscoped|0|q|auto')
    expect(
      getExplainResultIdentity(
        result({}, { scenario_id: 's', capture_index: 2, plan_cache_mode: 'force_custom_plan' }),
      ),
    ).toBe('s|2|q|force_custom_plan')
  })

  it('subtracts the baseline and requires WAL to repeat', () => {
    const first = [result(spill), result(wal(100), { name: 'w' })]
    const repeatedClean = [result(spill), result(wal(1), { name: 'w' })]
    const regressions = findPressureRegressions(
      first,
      repeatedClean,
      { 'unscoped|0|q|auto': ['Sort:-:temp-read'] },
      thresholds,
    )
    expect(regressions).toEqual([
      'unscoped|0|q|auto=Hash:events:hash-batches',
      'unscoped|0|q|auto=Sort:-:disk-spill',
      'unscoped|0|q|auto=Sort:-:temp-written',
    ])
    expect(findPressureRegressions(first.slice(1), [], undefined, thresholds)).toEqual([
      'unscoped|0|w|auto=ModifyTable:t:wal',
    ])
  })

  it('throws a summary for new pressure and passes a baselined run', () => {
    expect(() => assertNoPressureRegressions([result(spill)], [])).toThrow(
      /new disallowed temp, spill, hash-batch, or WAL pressure: unscoped\|0\|q\|auto=Hash/,
    )
    expect(() =>
      assertNoPressureRegressions([result(spill)], [], {
        'unscoped|0|q|auto': [
          'Hash:events:hash-batches',
          'Sort:-:disk-spill',
          'Sort:-:temp-read',
          'Sort:-:temp-written',
        ],
      }),
    ).not.toThrow()
  })
})
