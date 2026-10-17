import {
  DEFAULT_MONTHLY_PARTITION_FUTURE_MONTHS,
  DEFAULT_MONTHLY_PARTITION_PAST_MONTHS,
  type MonthlyPartitionTableConfig,
} from './config.mts'
import { assertSafeSqlIdentifier } from './identifiers.mts'
import { timestampToUuidv7LowerBound } from './uuidv7-bounds.mts'

export type MonthlyPartitionName = { table: string; year: number; month: number }

export interface GenerateMonthlyPartitionsOptions {
  tables: readonly MonthlyPartitionTableConfig[]
  /** Defaults to now. Months are computed in UTC. */
  baseDate?: Date
}

/**
 * Creates explicit monthly UUIDv7 range partitions for each table across its past and future
 * window. Idempotent (`IF NOT EXISTS`); no default partition is created. Generated names
 * (`<table>__p_YYYY_MM`) must fit PostgreSQL's 63-byte identifier limit. The result holds several
 * commands, so run it through a migration file or split it; to execute directly, run
 * `generateMonthlyPartitionStatements` one statement at a time (see `createMonthlyPartitions`).
 */
export function generateMonthlyPartitions(options: GenerateMonthlyPartitionsOptions): string {
  return `/* generateMonthlyPartitions */\n${generateMonthlyPartitionStatements(options).join('\n')}`
}

/** One `CREATE TABLE ... PARTITION OF` statement per partition, without annotations. */
export function generateMonthlyPartitionStatements(
  options: GenerateMonthlyPartitionsOptions,
): string[] {
  const { tables, baseDate = new Date() } = options
  const baseYear = baseDate.getUTCFullYear()
  const baseMonth = baseDate.getUTCMonth()
  const statements: string[] = []
  for (const config of tables) {
    const table = assertSafeSqlIdentifier(config.table)
    const pastMonths = config.pastMonths ?? DEFAULT_MONTHLY_PARTITION_PAST_MONTHS
    const futureMonths = config.futureMonths ?? DEFAULT_MONTHLY_PARTITION_FUTURE_MONTHS
    for (const [name, value] of [
      ['pastMonths', pastMonths],
      ['futureMonths', futureMonths],
    ] as const) {
      if (!Number.isInteger(value) || value < 0) {
        throw new Error(`${name} must be a non-negative integer for ${table}: ${value}`)
      }
    }
    for (let offset = -pastMonths; offset <= futureMonths; offset++) {
      const startMs = Date.UTC(baseYear, baseMonth + offset, 1)
      const start = new Date(startMs)
      const name = assertSafeSqlIdentifier(
        buildMonthlyPartitionName(table, start.getUTCFullYear(), start.getUTCMonth() + 1),
      )
      const lower = timestampToUuidv7LowerBound(startMs)
      const upper = timestampToUuidv7LowerBound(Date.UTC(baseYear, baseMonth + offset + 1, 1))
      statements.push(
        `CREATE TABLE IF NOT EXISTS ${name}\nPARTITION OF ${table}\nFOR VALUES FROM ('${lower}') TO ('${upper}');`,
      )
    }
  }
  return statements
}

export function buildMonthlyPartitionName(table: string, year: number, month: number): string {
  return `${table}__p_${String(year)}_${String(month).padStart(2, '0')}`
}

export function parseMonthlyPartitionName(partitionName: string): MonthlyPartitionName | null {
  const match = /^(?<table>[a-z0-9_]+)__p_(?<year>\d{4})_(?<month>\d{2})$/u.exec(partitionName)
  const { table, year, month } = match?.groups ?? {}
  if (table === undefined || year === undefined || month === undefined) return null
  const monthNumber = Number(month)
  if (monthNumber < 1 || monthNumber > 12) return null
  return { table, year: Number(year), month: monthNumber }
}

/** True when the partition's exclusive upper bound is at or before `cutoffDate`. */
export function isMonthlyPartitionExpired(
  partition: { year: number; month: number },
  cutoffDate: Date,
): boolean {
  return Date.UTC(partition.year, partition.month, 1) <= cutoffDate.getTime()
}

/**
 * Creates a DEFAULT child for RANGE-partitioned tables with no retention requirement. Adding an
 * explicit range later fails while the default child holds rows inside it, so move those rows
 * out first. Multiple tables yield multiple commands; see `generateDefaultPartitionStatements`.
 */
export function generateDefaultPartitions(tables: readonly string[]): string {
  return `/* generateDefaultPartitions */\n${generateDefaultPartitionStatements(tables).join('\n')}`
}

/** One `CREATE TABLE ... PARTITION OF ... DEFAULT` statement per table, without annotations. */
export function generateDefaultPartitionStatements(tables: readonly string[]): string[] {
  return tables.map((table) => {
    const safe = assertSafeSqlIdentifier(table)
    const child = assertSafeSqlIdentifier(`${safe}__default`)
    return `CREATE TABLE IF NOT EXISTS ${child}\nPARTITION OF ${safe} DEFAULT;`
  })
}
