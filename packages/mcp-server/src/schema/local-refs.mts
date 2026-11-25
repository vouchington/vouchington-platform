const SCHEMA_MAPS = ['properties', 'patternProperties', '$defs', 'definitions'] as const
const SCHEMA_SINGLES = [
  'items',
  'additionalProperties',
  'not',
  'if',
  'then',
  'else',
  'contains',
  'propertyNames',
] as const
const SCHEMA_ARRAYS = ['oneOf', 'anyOf', 'allOf', 'prefixItems'] as const

/** Assert that a standalone MCP schema resolves every reference within its own `$defs`. */
export function assertLocalSchemaRefs(schema: unknown): void {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new Error('Expected an object schema')
  }
  const defs = (schema as Record<string, unknown>)['$defs']
  const definitions =
    defs && typeof defs === 'object' && !Array.isArray(defs)
      ? (defs as Record<string, unknown>)
      : {}
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    const node = value as Record<string, unknown>
    if ('$ref' in node) {
      const ref = node['$ref']
      if (typeof ref !== 'string' || !/^#\/\$defs\/[^/]+$/.test(ref)) {
        throw new Error(`Non-local MCP schema reference: ${String(ref)}`)
      }
      if (!Object.hasOwn(definitions, ref.slice('#/$defs/'.length))) {
        throw new Error(`Dangling MCP schema reference: ${ref}`)
      }
    }
    for (const keyword of SCHEMA_MAPS) {
      const children = node[keyword]
      if (children && typeof children === 'object' && !Array.isArray(children)) {
        for (const child of Object.values(children)) visit(child)
      }
    }
    for (const keyword of SCHEMA_SINGLES) visit(node[keyword])
    for (const keyword of SCHEMA_ARRAYS) {
      const children = node[keyword]
      if (Array.isArray(children)) for (const child of children) visit(child)
    }
  }
  visit(schema)
}
