export type Schema = Record<string, unknown>

const schemaMaps = ['properties', 'patternProperties'] as const
const schemaSingles = [
  'items',
  'additionalProperties',
  'not',
  'if',
  'then',
  'else',
  'contains',
  'propertyNames',
] as const
const schemaArrays = ['oneOf', 'anyOf', 'allOf', 'prefixItems'] as const

function isSchema(value: unknown): value is Schema {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Visit schema positions, excluding existing definitions used by the factoring pass. */
export function visitSchema(
  schema: Schema,
  visit: (node: Schema, root: boolean) => void,
  root = true,
  skipIds = false,
): void {
  // A nested `$id` starts its own resource, which references outside it cannot reach into.
  if (!root && skipIds && typeof schema['$id'] === 'string') return
  visit(schema, root)
  for (const keyword of schemaMaps) {
    const entries = schema[keyword]
    if (isSchema(entries))
      for (const child of Object.values(entries))
        if (isSchema(child)) visitSchema(child, visit, false, skipIds)
  }
  for (const keyword of schemaSingles) {
    const child = schema[keyword]
    if (isSchema(child)) visitSchema(child, visit, false, skipIds)
  }
  for (const keyword of schemaArrays) {
    const children = schema[keyword]
    if (Array.isArray(children))
      for (const child of children) if (isSchema(child)) visitSchema(child, visit, false, skipIds)
  }
}

/** Map schema positions, optionally including existing definitions for input closure. */
export function mapSchema(
  schema: Schema,
  transform: (node: Schema, root: boolean) => Schema,
  root = true,
  visitDefinitions = false,
  skipIds = false,
): Schema {
  if (!root && skipIds && typeof schema['$id'] === 'string') return schema
  const mapped: Schema = { ...schema }
  for (const keyword of schemaMaps) {
    const entries = schema[keyword]
    if (isSchema(entries))
      mapped[keyword] = Object.fromEntries(
        Object.entries(entries).map(([key, child]) => [
          key,
          isSchema(child) ? mapSchema(child, transform, false, visitDefinitions, skipIds) : child,
        ]),
      )
  }
  for (const keyword of schemaSingles) {
    const child = schema[keyword]
    if (isSchema(child))
      mapped[keyword] = mapSchema(child, transform, false, visitDefinitions, skipIds)
  }
  for (const keyword of schemaArrays) {
    const children = schema[keyword]
    if (Array.isArray(children))
      mapped[keyword] = children.map((child) =>
        isSchema(child) ? mapSchema(child, transform, false, visitDefinitions, skipIds) : child,
      )
  }
  if (visitDefinitions) {
    for (const keyword of ['$defs', 'definitions']) {
      const definitions = schema[keyword]
      if (isSchema(definitions))
        mapped[keyword] = Object.fromEntries(
          Object.entries(definitions).map(([key, child]) => [
            key,
            isSchema(child) ? mapSchema(child, transform, false, true, skipIds) : child,
          ]),
        )
    }
  }
  // Factoring leaves existing definitions intact to avoid rewriting one into a self-reference.
  return transform(mapped, root)
}
