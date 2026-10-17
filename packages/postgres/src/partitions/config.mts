export type MonthlyPartitionTableConfig = {
  table: string
  /** Months before the base month to create. Defaults to `DEFAULT_MONTHLY_PARTITION_PAST_MONTHS`. */
  pastMonths?: number
  /** Months after the base month to create. Defaults to `DEFAULT_MONTHLY_PARTITION_FUTURE_MONTHS`. */
  futureMonths?: number
  /** Partitions whose upper bound is older than `now - retentionDays` are retirable. */
  retentionDays?: number
  /** Lower values are retired first, so referencing tables can go before their parents. */
  dropPriority?: number
}

export const DEFAULT_MONTHLY_PARTITION_PAST_MONTHS = 1
export const DEFAULT_MONTHLY_PARTITION_FUTURE_MONTHS = 12

/** Tables whose partitions are eligible for retirement. */
export function filterRetainedMonthlyPartitionTables(
  tables: readonly MonthlyPartitionTableConfig[],
): MonthlyPartitionTableConfig[] {
  return tables.filter((config) => config.retentionDays !== undefined)
}
