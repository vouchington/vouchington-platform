import type { McpToolMeta, ToolApiEndpoint } from '../types.mts'

/**
 * Builds `meta.selectApi` for a tool whose string argument picks the one REST route a call
 * exercises. A value with no entry exercises no listed route, so nothing is charged for it.
 */
export function selectApiByArgument(
  argument: string,
  endpoints: Readonly<Record<string, ToolApiEndpoint>>,
): NonNullable<McpToolMeta['selectApi']> {
  return (args) => {
    const value = args[argument]
    const endpoint =
      typeof value === 'string' && Object.hasOwn(endpoints, value) ? endpoints[value] : undefined
    return endpoint ? [endpoint] : []
  }
}
