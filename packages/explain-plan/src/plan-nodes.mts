export type PlanNode = Record<string, unknown>

/** Physical rows touched by one scan, including rows rejected by its predicates. */
export function processedRows(node: PlanNode): number {
  return (
    (Number(node['Actual Rows'] ?? 0) +
      Number(node['Rows Removed by Filter'] ?? 0) +
      Number(node['Rows Removed by Index Recheck'] ?? 0)) *
    Number(node['Actual Loops'] ?? 1)
  )
}

/** Flattens a plan (or its `{ Plan }` wrapper) into every node that has a `Node Type`. */
export function collectPlanNodes(value: unknown, nodes: PlanNode[] = []): PlanNode[] {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return nodes
  const node = value as PlanNode
  if (typeof node['Node Type'] === 'string') nodes.push(node)
  const plans = node['Plans']
  if (Array.isArray(plans)) {
    for (const child of plans) collectPlanNodes(child, nodes)
  }
  collectPlanNodes(node['Plan'], nodes)
  return nodes
}

export function planNodeUsesIndex(node: PlanNode, index: string): boolean {
  if (node['Index Name'] === index) return true
  const arbiters = node['Conflict Arbiter Indexes']
  return Array.isArray(arbiters) && arbiters.includes(index)
}

/** Maps a partition or child relation name to the relation it belongs to. */
export type RelationResolver = (relationName: string) => string

/**
 * Resolves partition names to their parent. A name belongs to a parent when it equals it or
 * starts with the parent followed by one of `suffixes` (default `__` and `_default`); the
 * longest matching parent wins. Unmatched names resolve to themselves.
 */
export function createPartitionResolver(
  parents: Iterable<string>,
  suffixes: readonly string[] = ['__', '_default'],
): RelationResolver {
  const ordered = [...parents].toSorted((a, b) => b.length - a.length)
  return (relationName) =>
    ordered.find(
      (parent) =>
        relationName === parent ||
        suffixes.some((suffix) => relationName.startsWith(parent + suffix)),
    ) ?? relationName
}

export function baseRelationName(
  node: PlanNode,
  resolve: RelationResolver = (name) => name,
): string {
  const name = node['Relation Name']
  return resolve(typeof name === 'string' ? name : '')
}

/** A scan that touched rows, including rows a filter rejected. An unexecuted scan did no work. */
export function sequentiallyScanned(
  nodes: readonly PlanNode[],
  relation: string,
  resolve: RelationResolver = (name) => name,
): boolean {
  return nodes.some(
    (node) =>
      node['Node Type'] === 'Seq Scan' &&
      baseRelationName(node, resolve) === relation &&
      processedRows(node) > 0,
  )
}
