import type { QueryExecutor } from '../types.mts'
import type { MonthlyPartitionTableConfig } from './config.mts'
import { assertSafeSqlIdentifier } from './identifiers.mts'
import {
  listManagedMonthlyPartitions,
  selectExpiredMonthlyPartitions,
  type ExistingMonthlyPartitionRow,
  type ExpiredMonthlyPartition,
} from './select-expired.mts'
import {
  generateMonthlyPartitionStatements,
  type GenerateMonthlyPartitionsOptions,
} from './utils.mts'

/** A transaction as returned by `psql.beginTransaction()`. */
export type PartitionRetirementTransaction = QueryExecutor &
  AsyncDisposable & { commit: () => Promise<void> }

/**
 * Referential actions DROP does not fire (cascades, nulling references). Runs inside the
 * retirement transaction, after identifiers are validated, before the partition is detached.
 */
export type BeforeDetachPartition = (
  query: QueryExecutor,
  partition: ExpiredMonthlyPartition,
) => Promise<void>

export interface RetireMonthlyPartitionsOptions {
  startTransaction: () => Promise<PartitionRetirementTransaction>
  /**
   * Receives one error per partition that failed to retire; later partitions still run. Awaited,
   * so an async reporter may reject without stopping retirement.
   */
  reportError: (error: Error) => void | Promise<void>
  beforeDetach?: BeforeDetachPartition | undefined
}

export async function retireMonthlyPartition(
  query: QueryExecutor,
  partition: ExpiredMonthlyPartition,
  beforeDetach?: BeforeDetachPartition,
): Promise<void> {
  const table = assertSafeSqlIdentifier(partition.table)
  const partitionName = assertSafeSqlIdentifier(partition.partitionName)
  await beforeDetach?.(query, partition)
  await query(
    `/* retireMonthlyPartition:detach */ ALTER TABLE ${table} DETACH PARTITION ${partitionName}`,
  )
  await query(`/* retireMonthlyPartition:drop */ DROP TABLE ${partitionName}`)
}

/** Each partition retires in its own transaction; a failure rolls back only that partition. */
export async function retireExpiredMonthlyPartitions(
  partitions: readonly ExpiredMonthlyPartition[],
  options: RetireMonthlyPartitionsOptions,
): Promise<void> {
  async function retireAt(index: number): Promise<void> {
    const partition = partitions[index]
    if (!partition) return
    try {
      await using transaction = await options.startTransaction()
      await retireMonthlyPartition(transaction, partition, options.beforeDetach)
      await transaction.commit()
    } catch (err) {
      try {
        await options.reportError(
          new Error(`Failed to retire monthly partition ${partition.partitionName}`, {
            cause: err,
          }),
        )
      } catch {
        // a failing reporter must not stop later partitions from retiring
      }
    }
    await retireAt(index + 1)
  }
  await retireAt(0)
}

export interface CleanupMonthlyPartitionsOptions extends RetireMonthlyPartitionsOptions {
  /** Used to list existing partitions. */
  query: QueryExecutor
  tables: readonly MonthlyPartitionTableConfig[]
  referenceDate?: Date
}

/** Retires every partition of the configured tables that is past its retention window. */
export async function cleanupMonthlyPartitions(
  options: CleanupMonthlyPartitionsOptions,
): Promise<void> {
  const existing = await listManagedMonthlyPartitions(options.query, options.tables)
  const mismatched: ExistingMonthlyPartitionRow[] = []
  const expired = selectExpiredMonthlyPartitions(
    existing,
    options.tables,
    options.referenceDate ?? new Date(),
    (row) => mismatched.push(row),
  )
  for (const row of mismatched) {
    try {
      await options.reportError(
        new Error(
          `Skipped monthly partition ${row.partition_table}: bound ${row.partition_bound ?? 'null'} does not match its name`,
        ),
      )
    } catch {
      // a failing reporter must not stop retirement
    }
  }
  await retireExpiredMonthlyPartitions(expired, options)
}

/** Creates the configured monthly partitions one statement at a time; safe to rerun. */
export async function createMonthlyPartitions(
  query: QueryExecutor,
  options: GenerateMonthlyPartitionsOptions,
): Promise<void> {
  await generateMonthlyPartitionStatements(options).reduce(
    (previous, statement) =>
      previous.then(async () => {
        await query(`/* createMonthlyPartitions */ ${statement}`)
      }),
    Promise.resolve(),
  )
}
