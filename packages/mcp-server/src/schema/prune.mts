import type { JsonSchema } from '../types.mts'

const branchesOf = (schema: JsonSchema): JsonSchema[] =>
  Array.isArray(schema['anyOf']) ? (schema['anyOf'] as JsonSchema[]).flatMap(branchesOf) : [schema]

/**
 * `value` reduced to what `schema` declares.
 *
 * A tool whose service returns a richer entity than its REST twin documents uses this, so a closed
 * (`additionalProperties: false`) output schema never turns a mutation that already committed into
 * a failed call. Objects keep the declared properties, arrays prune each item, and an `anyOf`
 * contributes the properties of its object branches. Anything the schema says nothing about, such
 * as a primitive or an object with no declared properties, is returned as it is.
 */
export function pruneToSchema(schema: JsonSchema, value: unknown): unknown {
  const branches = branchesOf(schema)
  if (Array.isArray(value)) {
    const items = branches.find((branch) => branch['items'])?.['items'] as JsonSchema | undefined
    return items ? value.map((item) => pruneToSchema(items, item)) : value
  }
  if (value === null || typeof value !== 'object') return value

  const declared = Object.assign(
    {},
    ...branches.flatMap((branch) => (branch['properties'] ? [branch['properties']] : [])),
  ) as Record<string, JsonSchema>
  if (Object.keys(declared).length === 0) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key in declared)
      .map(([key, child]) => [key, pruneToSchema(declared[key]!, child)]),
  )
}
