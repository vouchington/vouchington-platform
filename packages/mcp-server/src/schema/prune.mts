import type { JsonSchema } from '../types.mts'

const LOCAL_DEFINITION = /^#\/\$defs\/(.+)$/

// The object-shaped alternatives of a schema: `anyOf` branches are flattened and local `$defs`
// references are followed (once each, so a self-reference cannot loop).
function branchesOf(
  root: JsonSchema,
  schema: JsonSchema,
  seen: readonly string[] = [],
): JsonSchema[] {
  if (Array.isArray(schema['anyOf']))
    return (schema['anyOf'] as JsonSchema[]).flatMap((branch) => branchesOf(root, branch, seen))
  const name =
    typeof schema['$ref'] === 'string' ? LOCAL_DEFINITION.exec(schema['$ref'])?.[1] : undefined
  const definitions = root['$defs'] as Record<string, JsonSchema> | undefined
  if (
    name === undefined ||
    seen.includes(name) ||
    !definitions ||
    !Object.hasOwn(definitions, name)
  )
    return [schema]
  return branchesOf(root, definitions[name]!, [...seen, name])
}

/**
 * `value` reduced to what `schema` declares.
 *
 * A tool whose service returns a richer entity than its REST twin documents uses this, so a closed
 * (`additionalProperties: false`) output schema never turns a mutation that already committed into
 * a failed call. Objects keep the declared properties, arrays prune each item, and an `anyOf`
 * contributes the properties of its object branches. A property declared by several branches is
 * pruned against all of its declarations. Local `#/$defs/*` references resolve against `schema`.
 * Anything the schema says nothing about, such as a primitive or an object with no declared
 * properties, is returned as it is.
 */
export function pruneToSchema(schema: JsonSchema, value: unknown): unknown {
  return prune(schema, schema, value)
}

function prune(root: JsonSchema, schema: JsonSchema, value: unknown): unknown {
  const branches = branchesOf(root, schema)
  if (Array.isArray(value)) {
    const items = branches.find((branch) => branch['items'])?.['items'] as JsonSchema | undefined
    return items ? value.map((item) => prune(root, items, item)) : value
  }
  if (value === null || typeof value !== 'object') return value

  const declared: Record<string, JsonSchema[]> = {}
  for (const branch of branches) {
    const properties = branch['properties'] as Record<string, JsonSchema> | undefined
    for (const [key, child] of Object.entries(properties ?? {})) (declared[key] ??= []).push(child)
  }
  if (Object.keys(declared).length === 0) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key in declared)
      .map(([key, child]) => {
        const alternatives = declared[key]!
        return [
          key,
          prune(
            root,
            alternatives.length === 1 ? alternatives[0]! : { anyOf: alternatives },
            child,
          ),
        ]
      }),
  )
}
