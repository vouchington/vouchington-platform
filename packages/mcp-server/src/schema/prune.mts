import type { JsonSchema } from '../types.mts'

const LOCAL_DEFINITION = /^#\/\$defs\/(.+)$/

// The object-shaped alternatives of a schema: `anyOf` and `oneOf` branches are flattened and local `$defs`
// references are followed (once each, so a self-reference cannot loop).
function branchesOf(
  root: JsonSchema,
  schema: JsonSchema,
  seen: readonly string[] = [],
): JsonSchema[] {
  // Declarations written beside `anyOf` or `oneOf` apply too, so the node itself is one of the
  // alternatives.
  const alternatives = [schema['anyOf'], schema['oneOf']].flatMap((list) =>
    Array.isArray(list) ? (list as JsonSchema[]) : [],
  )
  if (alternatives.length > 0)
    return [schema, ...alternatives.flatMap((branch) => branchesOf(root, branch, seen))]
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
 * a failed call. Objects keep the declared properties, arrays prune each item, and an `anyOf` or `oneOf`
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
    const alternatives = branches.flatMap((branch) =>
      branch['items'] ? [branch['items'] as JsonSchema] : [],
    )
    if (alternatives.length === 0) return value
    const items = alternatives.length === 1 ? alternatives[0]! : { anyOf: alternatives }
    return value.map((item) => prune(root, items, item))
  }
  if (value === null || typeof value !== 'object') return value

  const declared = new Map<string, JsonSchema[]>()
  for (const branch of branches) {
    const properties = branch['properties'] as Record<string, JsonSchema> | undefined
    for (const [key, child] of Object.entries(properties ?? {}))
      declared.set(key, [...(declared.get(key) ?? []), child])
  }
  if (declared.size === 0) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => declared.has(key))
      .map(([key, child]) => {
        const alternatives = declared.get(key)!
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
