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
  expectedMonthlyPartitionBound,
  getMonthlyPartitionCutoffDate,
  listManagedMonthlyPartitions,
  selectExpiredMonthlyPartitions,
} from './select-expired.mts'

const withPsql = useIsolatedDatabase()
const row = (parent: string, name: string, year?: number, month?: number) => ({
  parent_table: parent,
  partition_table: name,
  partition_bound:
    year === undefined || month === undefined
      ? 'DEFAULT'
      : expectedMonthlyPartitionBound(year, month),
})
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
    row('events', 'events__p_2026_05', 2026, 5),
    row('events', 'events__p_2026_01', 2026, 1),
    row('events', 'events__p_2025_12', 2025, 12),
    row('child_events', 'child_events__p_2026_01', 2026, 1),
    row('events', 'events__default'),
    row('events', 'other__p_2020_01', 2020, 1),
    row('forever', 'forever__p_2020_01', 2020, 1),
    row('unknown', 'unknown__p_2020_01', 2020, 1),
  ]

  it('orders by priority, then age, and skips unmanaged or unexpired children', () => {
    expect(
      selectExpiredMonthlyPartitions(rows, tables, referenceDate).map((p) => p.partitionName),
    ).toEqual(['child_events__p_2026_01', 'events__p_2025_12', 'events__p_2026_01'])
  })

  it('skips and reports a child whose bound does not match its name', () => {
    const mismatches: string[] = []
    const result = selectExpiredMonthlyPartitions(
      [
        { ...row('events', 'events__p_2020_01'), partition_bound: 'DEFAULT' },
        { ...row('events', 'events__p_2020_02'), partition_bound: null },
        row('events', 'events__p_2020_03', 2020, 4),
        row('events', 'events__p_2020_04', 2020, 4),
      ],
      [{ table: 'events', retentionDays: 1 }],
      referenceDate,
      (mismatch) => mismatches.push(mismatch.partition_table),
    )
    expect(result.map((p) => p.partitionName)).toEqual(['events__p_2020_04'])
    expect(mismatches).toEqual(['events__p_2020_01', 'events__p_2020_02', 'events__p_2020_03'])
    expect(
      selectExpiredMonthlyPartitions(
        [row('events', 'events__p_2020_03', 2020, 4)],
        [{ table: 'events', retentionDays: 1 }],
        referenceDate,
      ),
    ).toEqual([])
  })

  it('sorts unprioritized tables last and ties by name', () => {
    const result = selectExpiredMonthlyPartitions(
      [
        row('b', 'b__p_2020_01', 2020, 1),
        row('a', 'a__p_2020_01', 2020, 1),
        row('a', 'a__p_2020_02', 2020, 2),
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
      [row('a', 'a__p_2020_01', 2020, 1), row('a', 'a__p_2020_01', 2020, 1)],
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
          [row('a', 'a__p_2026_06', 2026, 6)],
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

  it('keeps retiring when the error reporter throws', async () => {
    const attempted: string[] = []
    const startTransaction = vi.fn(async () => {
      const query = vi.fn(async (sql: string) => {
        attempted.push(sql)
        throw new Error('boom')
      })
      return Object.assign(query, {
        commit: async () => {},
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
      {
        startTransaction,
        reportError: () => {
          throw new Error('reporter broke')
        },
      },
    )
    expect(attempted).toHaveLength(2)
  })

  it('awaits an async reporter and survives its rejection', async () => {
    const order: string[] = []
    const startTransaction = vi.fn(async () => {
      const query = vi.fn(async () => {
        throw new Error('boom')
      })
      return Object.assign(query, {
        commit: async () => {},
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
      {
        startTransaction,
        reportError: async (error) => {
          await Promise.resolve()
          order.push(error.message)
          throw new Error('flush failed')
        },
      },
    )
    expect(order).toEqual([
      'Failed to retire monthly partition a__p_2020_01',
      'Failed to retire monthly partition a__p_2020_02',
    ])
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
