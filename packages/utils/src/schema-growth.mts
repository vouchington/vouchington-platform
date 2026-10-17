type GrowthPolicyGroup = {
  /** Why these tables may grow without a time or size bound. */
  reason: string
  tables: readonly string[]
  /** Skip tables that are partitioned (they are bounded by partition retention instead). */
  excludePartitioned?: boolean
}

export interface BuildUnboundedTablesOptions {
  partitionedTables: ReadonlySet<string>
  /** Applied in order; a later group or entry overrides an earlier reason for the same table. */
  groups?: readonly GrowthPolicyGroup[]
  /** Per-table `[table, reason]` entries, applied after `groups`. */
  entries?: Iterable<readonly [table: string, reason: string]>
}

export type TableGrowthClass = 'partitioned' | 'unbounded' | 'unclassified'

/** Maps every deliberately unbounded, unpartitioned table to its documented reason. */
export function buildUnboundedUnpartitionedTables(
  options: BuildUnboundedTablesOptions,
): Map<string, string> {
  const result = new Map<string, string>()
  for (const group of options.groups ?? []) {
    for (const table of group.tables) {
      if (group.excludePartitioned && options.partitionedTables.has(table)) continue
      result.set(table, group.reason)
    }
  }
  for (const [table, reason] of options.entries ?? []) result.set(table, reason)
  return result
}

/** Partitioned wins over unbounded; anything else needs an explicit growth decision. */
export function classifyTableGrowth(
  table: string,
  partitionedTables: ReadonlySet<string>,
  unboundedTables: ReadonlyMap<string, string>,
): TableGrowthClass {
  if (partitionedTables.has(table)) return 'partitioned'
  return unboundedTables.has(table) ? 'unbounded' : 'unclassified'
}
