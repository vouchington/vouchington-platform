import { describe, expect, it, vi } from 'vitest'

import { useIsolatedDatabase } from '../test-helpers.mts'
import type { QueryExecutor } from '../types.mts'
import {
  cleanupMonthlyPartitions,
  createMonthlyPartitions,
  retireExpiredMonthlyPartitions,
  retireMonthlyPartition,
} from './retire.mts'
import {
  getMonthlyPartitionCutoffDate,
  listManagedMonthlyPartitions,
  selectExpiredMonthlyPartitions,
} from './select-expired.mts'

const withPsql = useIsolatedDatabase()
const referenceDate = new Date(Date.UTC(2026, 5, 15))

const tables = [
  { table: 'child_events', retentionDays: 30, dropPriority: 0, pastMonths: 6, futureMonths: 0 },
  { table: 'events', retentionDays: 30, dropPriority: 1, pastMonths: 6, futureMonths: 0 },
  { table: 'forever', pastMonths: 0, futureMonths: 0 },
]

async function partitionNames(query: QueryExecutor): Promise<string[]> {
  const { rows } = await query<{ relname: string }>(
    `/* partitionNames */ SELECT child.relname FROM pg_inherits
      JOIN pg_class child ON child.oid = inhrelid ORDER BY 1`,
  )
  return rows.map((row) => row.relname)
}

describe('selectExpiredMonthlyPartitions', () => {
  const rows = [
    { parent_table: 'events', partition_table: 'events__p_2026_05' },
    { parent_table: 'events', partition_table: 'events__p_2026_01' },
    { parent_table: 'events', partition_table: 'events__p_2025_12' },
    { parent_table: 'child_events', partition_table: 'child_events__p_2026_01' },
    { parent_table: 'events', partition_table: 'events__default' },
    { parent_table: 'events', partition_table: 'other__p_2020_01' },
    { parent_table: 'forever', partition_table: 'forever__p_2020_01' },
    { parent_table: 'unknown', partition_table: 'unknown__p_2020_01' },
  ]

  it('orders by priority, then age, and skips unmanaged or unexpired children', () => {
    expect(
      selectExpiredMonthlyPartitions(rows, tables, referenceDate).map((p) => p.partitionName),
    ).toEqual(['child_events__p_2026_01', 'events__p_2025_12', 'events__p_2026_01'])
  })

  it('sorts unprioritized tables last and ties by name', () => {
    const result = selectExpiredMonthlyPartitions(
      [
        { parent_table: 'b', partition_table: 'b__p_2020_01' },
        { parent_table: 'a', partition_table: 'a__p_2020_01' },
        { parent_table: 'a', partition_table: 'a__p_2020_02' },
      ],
      [
        { table: 'a', retentionDays: 1 },
        { table: 'b', retentionDays: 1, dropPriority: 0 },
      ],
      referenceDate,
    )
    expect(result.map((p) => p.partitionName)).toEqual([
      'b__p_2020_01',
      'a__p_2020_01',
      'a__p_2020_02',
    ])
    expect(result[1]?.dropPriority).toBe(Number.MAX_SAFE_INTEGER)
    const tie = selectExpiredMonthlyPartitions(
      [
        { parent_table: 'a', partition_table: 'a__p_2020_01' },
        { parent_table: 'a', partition_table: 'a__p_2020_01' },
      ],
      [{ table: 'a', retentionDays: 1 }],
      referenceDate,
    )
    expect(tie).toHaveLength(2)
  })

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects retentionDays %s before choosing a destructive cutoff',
    (retentionDays) => {
      expect(() => getMonthlyPartitionCutoffDate(referenceDate, retentionDays)).toThrow(
        'retentionDays must be',
      )
      expect(() =>
        selectExpiredMonthlyPartitions(
          [{ parent_table: 'a', partition_table: 'a__p_2026_06' }],
          [{ table: 'a', retentionDays }],
          referenceDate,
        ),
      ).toThrow('retentionDays must be')
    },
  )

  it('computes cutoffs', () => {
    expect(getMonthlyPartitionCutoffDate(new Date(86_400_000 * 3), 1).getTime()).toBe(
      86_400_000 * 2,
    )
  })
})

describe('retireExpiredMonthlyPartitions', () => {
  it('lists nothing without retention tables', async () => {
    const query = vi.fn()
    await expect(listManagedMonthlyPartitions(query as never, [{ table: 'x' }])).resolves.toEqual(
      [],
    )
    expect(query).not.toHaveBeenCalled()
  })

  it('rejects unsafe identifiers before running SQL', async () => {
    const query = vi.fn()
    await expect(
      retireMonthlyPartition(query as never, {
        table: 'a',
        partitionName: 'a; drop',
        dropPriority: 0,
        year: 2020,
        month: 1,
      }),
    ).rejects.toThrow('Unsafe')
    expect(query).not.toHaveBeenCalled()
  })

  it('creates, lists, and retires partitions end to end', async () => {
    await withPsql(async (psql) => {
      for (const table of ['child_events', 'events', 'forever']) {
        await psql.write(
          `/* createParent */ CREATE TABLE ${table} (id uuid NOT NULL) PARTITION BY RANGE (id)`,
        )
      }
      await createMonthlyPartitions(psql.write, { tables, baseDate: referenceDate })
      await createMonthlyPartitions(psql.write, { tables, baseDate: referenceDate })
      const created = await partitionNames(psql.write)
      expect(created).toContain('events__p_2025_12')
      expect(created).toContain('events__p_2026_06')

      const beforeDetach = vi.fn(async (query: QueryExecutor, partition: { table: string }) => {
        await query(`/* beforeDetach */ SELECT '${partition.table}'`)
      })
      const reportError = vi.fn()
      await cleanupMonthlyPartitions({
        query: psql.write,
        tables,
        referenceDate,
        startTransaction: () => psql.beginTransaction(),
        reportError,
        beforeDetach,
      })
      expect(reportError).not.toHaveBeenCalled()
      expect(beforeDetach).toHaveBeenCalledTimes(10)
      const remaining = await partitionNames(psql.write)
      expect(remaining).toContain('events__p_2026_05')
      expect(remaining).not.toContain('events__p_2026_03')
      expect(remaining).toContain('forever__p_2026_06')
    })
  })

  it('defaults the reference date and works without a beforeDetach hook', async () => {
    await withPsql(async (psql) => {
      await psql.write(
        `/* createParent */ CREATE TABLE old_events (id uuid) PARTITION BY RANGE (id)`,
      )
      await createMonthlyPartitions(psql.write, {
        tables: [{ table: 'old_events', pastMonths: 0, futureMonths: 0, retentionDays: 1 }],
        baseDate: new Date(Date.UTC(2020, 0, 1)),
      })
      await cleanupMonthlyPartitions({
        query: psql.write,
        tables: [{ table: 'old_events', retentionDays: 1 }],
        startTransaction: () => psql.beginTransaction(),
        reportError: (error) => {
          throw error
        },
      })
      expect(await partitionNames(psql.write)).not.toContain('old_events__p_2020_01')
    })
  })

  it('reports a failed retirement with its cause and continues', async () => {
    const reportError = vi.fn()
    const commits: string[] = []
    const startTransaction = vi.fn(async () => {
      const query = vi.fn(async (sql: string) => {
        if (sql.includes('DROP TABLE a__p_2020_01')) throw new Error('boom')
        return { rows: [] }
      })
      return Object.assign(query, {
        commit: async () => {
          commits.push('commit')
        },
        [Symbol.asyncDispose]: async () => {},
      }) as never
    })
    await retireExpiredMonthlyPartitions(
      ['a__p_2020_01', 'a__p_2020_02'].map((partitionName, index) => ({
        table: 'a',
        partitionName,
        dropPriority: 0,
        year: 2020,
        month: index + 1,
      })),
      { startTransaction, reportError },
    )
    expect(commits).toEqual(['commit'])
    expect(reportError).toHaveBeenCalledOnce()
    const error = reportError.mock.calls[0]?.[0] as Error
    expect(error.message).toBe('Failed to retire monthly partition a__p_2020_01')
    expect((error.cause as Error).message).toBe('boom')
  })
})
