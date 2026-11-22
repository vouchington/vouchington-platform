import { describe, expect, it } from 'vitest'
import { createPartitionResolver } from './plan-nodes.mts'
import { formatMarkdownReport } from './report.mts'
import { result } from './test-helpers.mts'

const options = {
  largeTables: new Set(['events']),
  resolveRelation: createPartitionResolver(['events']),
}

const noisyPlan = {
  Plan: {
    'Node Type': 'Append',
    Plans: [
      {
        'Node Type': 'Seq Scan',
        'Relation Name': 'events__1',
        'Actual Rows': 1,
        'Plan Rows': 500,
        'Shared Hit Blocks': 20000,
      },
      { 'Node Type': 'Result' },
      { 'Node Type': 'Result' },
    ],
  },
}

describe('formatMarkdownReport', () => {
  it('renders a table, call findings, and warning details slowest first', () => {
    const noisy = result(noisyPlan, {
      name: 'noisy:v2',
      execution_time_ms: 5,
      planning_time_ms: 4,
      function_calls: [{ funcname: 'f', calls: 80, total_time: 0, self_time: 0 }],
    })
    const parallel = result(
      { 'Node Type': 'Gather', 'Workers Launched': 1 },
      { name: 'par', execution_time_ms: 1 },
    )
    const calm = result({ 'Node Type': 'Result' }, { name: 'calm', execution_time_ms: 99 })
    const text = formatMarkdownReport([noisy, parallel, calm], {
      ...options,
      source: 'results.json',
      displayName: (name) => name.replace(':v2', ''),
      columns: [{ header: 'Kind', value: (r) => (r.name === 'calm' ? 'fast' : 'slow') }],
    })
    const lines = text.split('\n')
    expect(lines[2]).toBe('| Query | Kind | Exec (ms) | Plan (ms) | Warnings |')
    expect(lines[3]).toBe('|-------|------|----------:|----------:|----------|')
    expect(lines[4]).toBe('| calm | fast | 99.0 | 1.0 | - |')
    expect(text).toContain(
      '| noisy | slow | 5.0 | 4.0 | Seq scan: events__1; Est. mismatch 500x on events__1; Append overhead: 3 children; High plan ratio: 4.0ms/5.0ms; High buffers: 20000 shared on events__1 |',
    )
    expect(text).toContain('- noisy:v2: f called 80 times')
    expect(text).toContain(
      '- par: incomplete: parallel workers omit calls from leader-local counts',
    )
    expect(text).toContain('**noisy:v2** (exec 5.0ms, plan 4.0ms)')
    expect(text).toContain('- Seq scan on `events__1` (1 rows scanned, 1 rows output)')
    expect(text).toContain(
      '- Row estimate mismatch: Seq Scan on `events__1` — estimated 500, actual 1 (500x)',
    )
    expect(text).toContain('- Append node overhead: 3 children (Append)')
    expect(text).toContain('- High planning:execution ratio: 4.0ms planning vs 5.0ms execution')
    expect(text).toContain(
      '- High shared buffers: Seq Scan on `events__1` touched 20000 shared blocks (20000 hit, 0 read, 0 dirtied, 0 written)',
    )
    expect(text.endsWith('*3 queries analyzed from results.json*')).toBe(true)
  })

  it('reports resource pressure in the table and details', () => {
    const plan = {
      Plan: {
        'Node Type': 'Sort',
        'Sort Space Type': 'Disk',
        'Temp Written Blocks': 4,
        Plans: [{ 'Node Type': 'Hash', 'Relation Name': 'x', 'Hash Batches': 2 }],
      },
    }
    const text = formatMarkdownReport([result(plan)], { largeTables: new Set() })
    expect(text).toContain('Resource pressure: Sort on unnamed, Hash on x')
    expect(text).toContain(
      '- Resource pressure: Sort on unnamed (0 temp blocks read, 4 written, 0 WAL bytes, disk sort)',
    )
    expect(text).toContain(
      '- Resource pressure: Hash on x (0 temp blocks read, 0 written, 0 WAL bytes, 2 hash batches)',
    )
  })

  it('renders a clean report without optional sections', () => {
    const text = formatMarkdownReport([result({ 'Node Type': 'Result' })], {
      largeTables: new Set(),
    })
    expect(text).not.toContain('### ')
    expect(text).toContain('| q | 10.0 | 1.0 | - |')
    expect(text.endsWith('*1 queries analyzed*')).toBe(true)
  })

  it('names the node type when a buffer-heavy node has no relation name fallback', () => {
    const plan = { 'Node Type': 'Seq Scan', 'Relation Name': 'x', 'Shared Hit Blocks': 20000 }
    expect(formatMarkdownReport([result(plan)], { largeTables: new Set() })).toContain(
      'High buffers: 20000 shared on x',
    )
  })
})
