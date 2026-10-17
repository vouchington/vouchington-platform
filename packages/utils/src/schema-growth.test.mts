import { describe, expect, it } from 'vitest'

import { buildUnboundedUnpartitionedTables, classifyTableGrowth } from './schema-growth.mts'

describe('schema growth classification', () => {
  const partitioned = new Set(['events'])

  it('applies groups, partition exclusion, and later overrides in order', () => {
    const unbounded = buildUnboundedUnpartitionedTables({
      partitionedTables: partitioned,
      groups: [
        { reason: 'entities', tables: ['users', 'events'], excludePartitioned: true },
        { reason: 'audit', tables: ['events', 'users_log'] },
        { reason: 'edges', tables: ['edge'] },
      ],
      entries: [['users', 'special']],
    })
    expect([...unbounded]).toEqual([
      ['users', 'special'],
      ['events', 'audit'],
      ['users_log', 'audit'],
      ['edge', 'edges'],
    ])
  })

  it('defaults to an empty map', () => {
    expect(buildUnboundedUnpartitionedTables({ partitionedTables: partitioned }).size).toBe(0)
  })

  it('classifies tables', () => {
    const unbounded = new Map([
      ['users', 'why'],
      ['events', 'why'],
    ])
    expect(classifyTableGrowth('events', partitioned, unbounded)).toBe('partitioned')
    expect(classifyTableGrowth('users', partitioned, unbounded)).toBe('unbounded')
    expect(classifyTableGrowth('new_table', partitioned, unbounded)).toBe('unclassified')
  })
})
