export function groupMembershipSkusByPlan<Plan extends PropertyKey, Sku extends { plan: Plan }>(
  skus: readonly Sku[],
): Map<Plan, Sku[]> {
  const grouped = new Map<Plan, Sku[]>()
  for (const sku of skus) {
    const entries = grouped.get(sku.plan)
    if (entries) entries.push(sku)
    else grouped.set(sku.plan, [sku])
  }
  return grouped
}
