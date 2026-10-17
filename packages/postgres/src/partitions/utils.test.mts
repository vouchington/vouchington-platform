import { describe, expect, it } from 'vitest'

import { filterRetainedMonthlyPartitionTables } from './config.mts'
import { assertSafeSqlIdentifier } from './identifiers.mts'
import { getUtcDayUuidv7Bounds, timestampToUuidv7LowerBound } from './uuidv7-bounds.mts'
import {
  buildMonthlyPartitionName,
  generateDefaultPartitionStatements,
  generateDefaultPartitions,
  generateMonthlyPartitions,
  isMonthlyPartitionExpired,
  parseMonthlyPartitionName,
} from './utils.mts'

describe('uuidv7 bounds', () => {
  it('encodes the timestamp into a minimal UUIDv7', () => {
    expect(timestampToUuidv7LowerBound(0)).toBe('00000000-0000-7000-8000-000000000000')
    expect(timestampToUuidv7LowerBound(0xffff_ffff_ffff)).toBe(
      'ffffffff-ffff-7000-8000-000000000000',
    )
  })

  it.each([-1, 1.5, Number.NaN, 0x1_0000_0000_0000])('rejects %s', (value) => {
    expect(() => timestampToUuidv7LowerBound(value)).toThrow('48-bit')
  })

  it('bounds a UTC day', () => {
    const { startBound, endBound } = getUtcDayUuidv7Bounds('2026-03-01')
    expect(startBound).toBe(timestampToUuidv7LowerBound(Date.UTC(2026, 2, 1)))
    expect(endBound).toBe(timestampToUuidv7LowerBound(Date.UTC(2026, 2, 2)))
  })

  it.each(['2026-3-1', '2026-13-01', '2026-02-30', 'nope'])('rejects day %s', (day) => {
    expect(() => getUtcDayUuidv7Bounds(day)).toThrow('Invalid UTC day')
  })
})

describe('identifiers and config', () => {
  it('guards identifiers', () => {
    expect(assertSafeSqlIdentifier('posts_2')).toBe('posts_2')
    expect(() => assertSafeSqlIdentifier('posts; DROP')).toThrow('Unsafe SQL identifier')
    expect(() => assertSafeSqlIdentifier('2026_events')).toThrow('Unsafe SQL identifier')
    expect(() => assertSafeSqlIdentifier('a'.repeat(64))).toThrow('Unsafe SQL identifier')
    expect(assertSafeSqlIdentifier('a'.repeat(63))).toHaveLength(63)
  })

  it('keeps only tables with retention', () => {
    expect(
      filterRetainedMonthlyPartitionTables([{ table: 'a', retentionDays: 1 }, { table: 'b' }]),
    ).toEqual([{ table: 'a', retentionDays: 1 }])
  })
})

describe('monthly partition SQL', () => {
  it('generates an annotated past and future window with defaults and overrides', () => {
    const sql = generateMonthlyPartitions({
      baseDate: new Date(Date.UTC(2026, 0, 15)),
      tables: [{ table: 'events', pastMonths: 0, futureMonths: 1 }, { table: 'logs' }],
    })
    expect(sql.startsWith('/* generateMonthlyPartitions */\n')).toBe(true)
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS events__p_2026_01\nPARTITION OF events')
    expect(sql).toContain('events__p_2026_02')
    expect(sql).not.toContain('events__p_2025_12')
    expect(sql).toContain('logs__p_2025_12')
    expect(sql).toContain('logs__p_2027_01')
    expect(sql).toContain(
      `FROM ('${timestampToUuidv7LowerBound(Date.UTC(2026, 0, 1))}') TO ('${timestampToUuidv7LowerBound(Date.UTC(2026, 1, 1))}')`,
    )
  })

  it('defaults the base date to now and rejects unsafe tables', () => {
    expect(
      generateMonthlyPartitions({ tables: [{ table: 'a', pastMonths: 0, futureMonths: 0 }] }),
    ).toContain('a__p_')
    expect(() => generateMonthlyPartitions({ tables: [{ table: 'a b' }] })).toThrow('Unsafe')
  })

  it('rejects tables whose generated partition names exceed the identifier limit', () => {
    expect(() =>
      generateMonthlyPartitions({
        tables: [{ table: 'a'.repeat(53), pastMonths: 0, futureMonths: 0 }],
      }),
    ).toThrow('Unsafe SQL identifier')
    expect(() => generateDefaultPartitions(['a'.repeat(56)])).toThrow('Unsafe SQL identifier')
  })

  it('exposes default partition statements individually', () => {
    expect(generateDefaultPartitionStatements(['a', 'b'])).toEqual([
      'CREATE TABLE IF NOT EXISTS a__default\nPARTITION OF a DEFAULT;',
      'CREATE TABLE IF NOT EXISTS b__default\nPARTITION OF b DEFAULT;',
    ])
  })

  it.each([Number.NaN, -1, 1.5])('rejects invalid window count %s', (value) => {
    expect(() =>
      generateMonthlyPartitions({ tables: [{ table: 'a', futureMonths: value }] }),
    ).toThrow('futureMonths must be a non-negative integer')
    expect(() =>
      generateMonthlyPartitions({ tables: [{ table: 'a', pastMonths: value }] }),
    ).toThrow('pastMonths must be a non-negative integer')
  })

  it('generates default partitions', () => {
    expect(generateDefaultPartitions(['a', 'b'])).toBe(
      '/* generateDefaultPartitions */\nCREATE TABLE IF NOT EXISTS a__default\nPARTITION OF a DEFAULT;\nCREATE TABLE IF NOT EXISTS b__default\nPARTITION OF b DEFAULT;',
    )
    expect(() => generateDefaultPartitions(['a-b'])).toThrow('Unsafe')
  })
})

describe('partition names', () => {
  it('builds and parses names', () => {
    expect(buildMonthlyPartitionName('events', 2026, 3)).toBe('events__p_2026_03')
    expect(parseMonthlyPartitionName('events__p_2026_03')).toEqual({
      table: 'events',
      year: 2026,
      month: 3,
    })
  })

  it.each(['events', 'events__p_2026_13', 'events__p_2026_00', 'Events__p_2026_01'])(
    'rejects %s',
    (name) => {
      expect(parseMonthlyPartitionName(name)).toBeNull()
    },
  )

  it('treats the upper bound as exclusive', () => {
    const partition = { year: 2026, month: 1 }
    expect(isMonthlyPartitionExpired(partition, new Date(Date.UTC(2026, 1, 1)))).toBe(true)
    expect(isMonthlyPartitionExpired(partition, new Date(Date.UTC(2026, 0, 31)))).toBe(false)
  })
})
