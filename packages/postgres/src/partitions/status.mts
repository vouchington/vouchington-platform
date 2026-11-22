import type { QueryExecutor } from '../types.mts'

export type PartitionStatusRow = {
  parent_table: string
  partition_name: string
  /** `pg_get_expr(relpartbound, oid)`. */
  partition_bound: string
  size_bytes: string | number
}

export interface PartitionStatusPartition<Refusal extends string = string> {
  name: string
  size_bytes: number
  /** Why the partition may not be dropped now; `null` when nothing refuses. */
  drop_refusal: Refusal | null
}

export interface PartitionStatusTable<Refusal extends string = string> {
  name: string
  partition_count: number
  total_size_bytes: number
  partitions: PartitionStatusPartition<Refusal>[]
}

export interface PartitionStatus<Refusal extends string = string> {
  tables: PartitionStatusTable<Refusal>[]
}

export interface GetPartitionStatusOptions<Refusal extends string> {
  query: QueryExecutor
  /**
   * Decides, per partition name, whether a drop would be refused. The application owns retention
   * policy and holds; without it every partition reports `null`.
   */
  resolveRefusals?: (
    rows: readonly PartitionStatusRow[],
  ) => Promise<ReadonlyMap<string, Refusal | null>> | ReadonlyMap<string, Refusal | null>
}

/** Every direct partition child of a partitioned table in the current schema, with its size. */
export async function listPartitionStatusRows(query: QueryExecutor): Promise<PartitionStatusRow[]> {
  const { rows } = await query<PartitionStatusRow>(
    `/* listPartitionStatusRows */
      SELECT parent.relname AS parent_table,
             child.relname AS partition_name,
             pg_get_expr(child.relpartbound, child.oid) AS partition_bound,
             pg_total_relation_size(child.oid) AS size_bytes
      FROM pg_inherits
      JOIN pg_class AS parent ON pg_inherits.inhparent = parent.oid
      JOIN pg_class AS child ON pg_inherits.inhrelid = child.oid
      JOIN pg_namespace AS ns ON parent.relnamespace = ns.oid
      WHERE ns.nspname = current_schema()
        AND parent.relkind = 'p'
      ORDER BY parent.relname, child.relname`,
  )
  return rows
}

/** Partition inventory grouped by parent table, with an injected per-partition drop refusal. */
export async function getPartitionStatus<Refusal extends string = string>(
  options: GetPartitionStatusOptions<Refusal>,
): Promise<PartitionStatus<Refusal>> {
  const rows = await listPartitionStatusRows(options.query)
  const refusals = (await options.resolveRefusals?.(rows)) ?? new Map<string, Refusal | null>()
  const byTable = new Map<string, PartitionStatusPartition<Refusal>[]>()
  for (const row of rows) {
    const partitions = byTable.get(row.parent_table) ?? []
    partitions.push({
      name: row.partition_name,
      size_bytes: Number.parseInt(String(row.size_bytes), 10),
      drop_refusal: refusals.get(row.partition_name) ?? null,
    })
    byTable.set(row.parent_table, partitions)
  }
  return {
    tables: [...byTable].map(([name, partitions]) => ({
      name,
      partition_count: partitions.length,
      total_size_bytes: partitions.reduce((sum, partition) => sum + partition.size_bytes, 0),
      partitions,
    })),
  }
}
