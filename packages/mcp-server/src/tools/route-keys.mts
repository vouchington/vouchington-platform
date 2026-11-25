import type { McpToolMeta, ToolApiEndpoint } from '../types.mts'

/** One rate-limit charge for a tool call: one or more route keys and the weight to deduct. */
export type ToolRouteCharge = {
  routeKeys: readonly string[]
  weight: number
}

/**
 * The canonical rate-limit bucket key for a REST route. Both `:param` and `{param}` placeholders
 * normalize to `:param`.
 */
export function toRouteKey(endpoint: ToolApiEndpoint): string {
  return `${endpoint.method}:${endpoint.path.replaceAll(/\{([^}]+)\}/g, ':$1')}`
}

/**
 * The REST route charges a validated tool call exercises. Unweighted endpoints combine into one
 * weight-1 charge; weighted endpoints (positive safe integers) produce one charge per route key
 * using the largest declared weight for that route.
 */
export function toolRouteCharges(
  meta: Pick<McpToolMeta, 'api' | 'selectApi'> | undefined,
  args: Record<string, unknown>,
): ToolRouteCharge[] {
  if (!meta?.api) return []
  const endpoints = meta.selectApi ? meta.selectApi(args) : meta.api
  const weighted = new Map<string, number>()
  const unweighted: string[] = []
  for (const endpoint of endpoints) {
    const routeKey = toRouteKey(endpoint)
    if (
      typeof endpoint.weight === 'number' &&
      Number.isSafeInteger(endpoint.weight) &&
      endpoint.weight > 0
    ) {
      weighted.set(routeKey, Math.max(weighted.get(routeKey) ?? 0, endpoint.weight))
    } else {
      unweighted.push(routeKey)
    }
  }
  const charges: ToolRouteCharge[] = []
  const unweightedKeys = [...new Set(unweighted)]
  if (unweightedKeys.length > 0) charges.push({ routeKeys: unweightedKeys, weight: 1 })
  for (const [routeKey, weight] of weighted) {
    charges.push({ routeKeys: [routeKey], weight })
  }
  return charges
}
