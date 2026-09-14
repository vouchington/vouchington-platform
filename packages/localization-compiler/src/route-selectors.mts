import {
  chromeSelectorId,
  compareCodePoints,
  routeSelectorMembershipFromRecord,
  routeSelectorPatternMembershipFromRecord,
  routeSelectorId,
  type RouteSelector,
  type RouteSelectorMembership,
} from '@vouchington/localization'

export function expandRouteSelectors(rows: readonly unknown[]): {
  routeMembership: RouteSelectorMembership[]
  routeSelectors: RouteSelector[]
} {
  const membership: RouteSelectorMembership[] = []
  const selectors: RouteSelector[] = []
  const patterns = new Map<
    string,
    { consumer: 'web'; pattern: string; aliases: Set<string>; present: boolean }
  >()
  for (const raw of rows) {
    if (hasSelectorId(raw)) {
      const row = routeSelectorMembershipFromRecord(raw)
      membership.push(row)
      selectors.push({ consumer: row.consumer, selectorId: row.selectorId })
      continue
    }
    const row = routeSelectorPatternMembershipFromRecord(raw)
    if (row.consumer !== 'web') throw new TypeError('Pattern route membership only supports web')
    const key = `${row.consumer}\t${row.pattern}`
    const group = patterns.get(key) ?? {
      consumer: row.consumer,
      pattern: row.pattern,
      aliases: new Set(),
      present: false,
    }
    if (row.alias !== undefined) {
      if (group.aliases.has(row.alias))
        throw new TypeError(`Duplicate route membership "${row.pattern}" → "${row.alias}"`)
      group.aliases.add(row.alias)
    } else {
      if (group.present) throw new TypeError(`Duplicate route selector "${row.pattern}"`)
      group.present = true
    }
    patterns.set(key, group)
  }
  for (const group of patterns.values()) {
    const aliases = [...group.aliases].toSorted(compareCodePoints)
    const selectorId =
      group.pattern === 'web.chrome'
        ? chromeSelectorId(aliases)
        : routeSelectorId(group.pattern, aliases)
    selectors.push({ consumer: group.consumer, selectorId })
    membership.push(...aliases.map((alias) => ({ consumer: group.consumer, selectorId, alias })))
  }
  return {
    routeMembership: membership.toSorted(compareMembership),
    routeSelectors: uniqueSelectors(selectors),
  }
}

function hasSelectorId(value: unknown): value is { selectorId: unknown } {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && 'selectorId' in value
  )
}

function compareMembership(left: RouteSelectorMembership, right: RouteSelectorMembership): number {
  return compareCodePoints(
    `${left.consumer}\t${left.selectorId}\t${left.alias}`,
    `${right.consumer}\t${right.selectorId}\t${right.alias}`,
  )
}

function uniqueSelectors(selectors: readonly RouteSelector[]): RouteSelector[] {
  const known = new Set<string>()
  return selectors
    .toSorted((left, right) =>
      compareCodePoints(
        `${left.consumer}\t${left.selectorId}`,
        `${right.consumer}\t${right.selectorId}`,
      ),
    )
    .filter((selector) => {
      const key = `${selector.consumer}\t${selector.selectorId}`
      if (known.has(key)) return false
      known.add(key)
      return true
    })
}
