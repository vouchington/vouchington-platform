export type MembershipBenefitCatalogInput = {
  version: number
  plans: readonly PropertyKey[]
  groups: readonly {
    id: PropertyKey
    benefits: readonly {
      id: PropertyKey
      placements: readonly PropertyKey[]
      values: object
    }[]
  }[]
}

type CatalogBenefit<Catalog extends MembershipBenefitCatalogInput> =
  Catalog['groups'][number]['benefits'][number]
type CatalogBenefitId<Catalog extends MembershipBenefitCatalogInput> = CatalogBenefit<Catalog>['id']
type CatalogBenefitForId<
  Catalog extends MembershipBenefitCatalogInput,
  BenefitId extends CatalogBenefitId<Catalog>,
> = Extract<CatalogBenefit<Catalog>, { id: BenefitId }>
type CatalogBenefitValue<
  Catalog extends MembershipBenefitCatalogInput,
  BenefitId extends CatalogBenefitId<Catalog>,
  Plan extends Catalog['plans'][number],
> =
  CatalogBenefitForId<Catalog, BenefitId> extends { values: infer Values }
    ? Values extends Record<PropertyKey, unknown>
      ? Values[Plan & keyof Values]
      : never
    : never

export function buildMembershipBenefitCatalog<const Catalog extends MembershipBenefitCatalogInput>(
  catalog: Catalog,
  enforcedBenefitIds: ReadonlySet<CatalogBenefitId<Catalog>>,
): Catalog {
  const groupIds = new Set<PropertyKey>()
  const ids = new Set<PropertyKey>()
  for (const group of catalog.groups) {
    if (groupIds.has(group.id))
      throw new Error(`Duplicate membership benefit group: ${String(group.id)}`)
    groupIds.add(group.id)
    for (const benefit of group.benefits) {
      if (!enforcedBenefitIds.has(benefit.id)) {
        throw new Error(`Membership benefit is not enforced: ${String(benefit.id)}`)
      }
      if (ids.has(benefit.id))
        throw new Error(`Duplicate membership benefit: ${String(benefit.id)}`)
      ids.add(benefit.id)
      for (const plan of catalog.plans) {
        if (!Object.hasOwn(benefit.values, plan)) {
          throw new Error(`Membership benefit is missing a value for plan: ${String(plan)}`)
        }
      }
    }
  }
  return catalog
}

export function resolveMembershipBenefit<
  const Catalog extends MembershipBenefitCatalogInput,
  BenefitId extends CatalogBenefitId<Catalog>,
  Plan extends Catalog['plans'][number],
>(
  catalog: Catalog,
  benefitId: BenefitId,
  plan: Plan,
): CatalogBenefitValue<Catalog, BenefitId, Plan> | undefined {
  for (const group of catalog.groups) {
    const benefit = group.benefits.find((item) => item.id === benefitId)
    if (!benefit) continue
    if (!Object.hasOwn(benefit.values, plan)) return undefined
    return (benefit.values as Record<PropertyKey, unknown>)[plan] as CatalogBenefitValue<
      Catalog,
      BenefitId,
      Plan
    >
  }
  return undefined
}
