import type { QueryExecutor } from '../types.mts'
import {
  filterRetainedMonthlyPartitionTables,
  type MonthlyPartitionTableConfig,
} from './config.mts'
import { assertSafeSqlIdentifier } from './identifiers.mts'
import { isMonthlyPartitionExpired, parseMonthlyPartitionName } from './utils.mts'

export type ExistingMonthlyPartitionRow = { parent_table: string; partition_table: string }

export type ExpiredMonthlyPartition = {
  table: string
  partitionName: string
  dropPriority: number
  year: number
  month: number
}

const DAY_MS = 24 * 60 * 60 * 1000

export function getMonthlyPartitionCutoffDate(referenceDate: Date, retentionDays: number): Date {
  if (!Number.isFinite(retentionDays) || retentionDays < 0) {
    throw new Error(`retentionDays must be a finite, non-negative number: ${retentionDays}`)
  }
  return new Date(referenceDate.getTime() - retentionDays * DAY_MS)
}

/** Whole-partition retirement: effective retention is `retentionDays` plus up to one month. */
export function selectExpiredMonthlyPartitions(
  existingPartitions: readonly ExistingMonthlyPartitionRow[],
  tableConfigs: readonly MonthlyPartitionTableConfig[],
  referenceDate: Date,
): ExpiredMonthlyPartition[] {
  const configByTable = new Map(tableConfigs.map((config) => [config.table, config]))
  const expired: ExpiredMonthlyPartition[] = []
  for (const existing of existingPartitions) {
    const config = configByTable.get(existing.parent_table)
    const parsed = parseMonthlyPartitionName(existing.partition_table)
    if (config?.retentionDays === undefined || parsed?.table !== existing.parent_table) continue
    const cutoff = getMonthlyPartitionCutoffDate(referenceDate, config.retentionDays)
    if (!isMonthlyPartitionExpired(parsed, cutoff)) continue
    expired.push({
      table: config.table,
      partitionName: existing.partition_table,
      dropPriority: config.dropPriority ?? Number.MAX_SAFE_INTEGER,
      year: parsed.year,
      month: parsed.month,
    })
  }
  return expired.toSorted(
    (left, right) =>
      left.dropPriority - right.dropPriority ||
      left.year - right.year ||
      left.month - right.month ||
      left.partitionName.localeCompare(right.partitionName),
  )
}

/** Lists the direct children of the given parents in the current schema. */
export async function listManagedMonthlyPartitions(
  query: QueryExecutor,
  tableConfigs: readonly MonthlyPartitionTableConfig[],
): Promise<ExistingMonthlyPartitionRow[]> {
  const tableNames = filterRetainedMonthlyPartitionTables(tableConfigs).map((config) =>
    assertSafeSqlIdentifier(config.table),
  )
  if (tableNames.length === 0) return []
  const { rows } = await query<ExistingMonthlyPartitionRow>(
    `/* listManagedMonthlyPartitions */
      SELECT parent.relname AS parent_table, child.relname AS partition_table
      FROM pg_inherits
      JOIN pg_class AS parent ON pg_inherits.inhparent = parent.oid
      JOIN pg_class AS child ON pg_inherits.inhrelid = child.oid
      JOIN pg_namespace AS namespace ON parent.relnamespace = namespace.oid
      WHERE namespace.nspname = current_schema()
        AND parent.relname = ANY($1::text[])`,
    [tableNames],
  )
  return rows
}
