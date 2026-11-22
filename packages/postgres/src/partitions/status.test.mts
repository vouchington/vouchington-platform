import { describe, expect, it } from 'vitest'

import { withPsql } from '../test-helpers.mts'
import { getPartitionStatus, listPartitionStatusRows } from './status.mts'

async function withPartitions<Result>(
  run: (query: Parameters<typeof listPartitionStatusRows>[0]) => Promise<Result>,
): Promise<Result> {
  return withPsql(async (psql) => {
    const schema = `status_${crypto.randomUUID().replaceAll('-', '')}`
    await using transaction = await psql.beginTransaction()
    await transaction(`/* createSchema */ CREATE SCHEMA ${schema}`)
    await transaction(`/* setPath */ SET LOCAL search_path = ${schema}`)
    await transaction(
      `/* createParent */ CREATE TABLE events (id int PRIMARY KEY) PARTITION BY RANGE (id)`,
    )
    await transaction(
      `/* createA */ CREATE TABLE events_a PARTITION OF events FOR VALUES FROM (0) TO (10)`,
    )
    await transaction(
      `/* createB */ CREATE TABLE events_b PARTITION OF events FOR VALUES FROM (10) TO (20)`,
    )
    await transaction(`/* createParent */ CREATE TABLE logs (id int) PARTITION BY RANGE (id)`)
    await transaction(
      `/* createC */ CREATE TABLE logs_a PARTITION OF logs FOR VALUES FROM (0) TO (10)`,
    )
    return run(transaction)
  })
}

describe('partition status', () => {
  it('lists partition children with bounds and sizes', async () => {
    const rows = await withPartitions(listPartitionStatusRows)
    expect(rows.map((row) => [row.parent_table, row.partition_name, row.partition_bound])).toEqual([
      ['events', 'events_a', 'FOR VALUES FROM (0) TO (10)'],
      ['events', 'events_b', 'FOR VALUES FROM (10) TO (20)'],
      ['logs', 'logs_a', 'FOR VALUES FROM (0) TO (10)'],
    ])
    expect(Number(rows[0]?.size_bytes)).toBeGreaterThanOrEqual(0)
  })

  it('groups by table and applies injected refusals', async () => {
    const status = await withPartitions((query) =>
      getPartitionStatus({
        query,
        resolveRefusals: (rows) => {
          expect(rows).toHaveLength(3)
          return new Map([['events_a', 'inside-retention' as const]])
        },
      }),
    )
    expect(status.tables.map((table) => [table.name, table.partition_count])).toEqual([
      ['events', 2],
      ['logs', 1],
    ])
    const events = status.tables[0]!
    expect(events.partitions.map((partition) => partition.drop_refusal)).toEqual([
      'inside-retention',
      null,
    ])
    expect(events.total_size_bytes).toBe(
      events.partitions.reduce((sum, p) => sum + p.size_bytes, 0),
    )
  })

  it('reports no refusals without a resolver', async () => {
    const status = await withPartitions((query) => getPartitionStatus({ query }))
    expect(status.tables.flatMap((table) => table.partitions.map((p) => p.drop_refusal))).toEqual([
      null,
      null,
      null,
    ])
  })
})
