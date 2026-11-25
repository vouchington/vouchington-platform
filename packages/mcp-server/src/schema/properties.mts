import type { JsonSchema } from '../types.mts'

function objectProperties(schema: JsonSchema): Record<string, JsonSchema> {
  if (schema['$defs']) throw new Error('A recursive response contract cannot be nested.')
  const properties = schema['properties']
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return {}
  return properties as Record<string, JsonSchema>
}

/**
 * The named properties of an object schema. Throws when the schema is recursive (`$defs`) or
 * lacks any requested property.
 */
export function pickSchemaProperties(
  schema: JsonSchema,
  keys: readonly string[],
  contractName?: string,
): Record<string, JsonSchema> {
  const properties = objectProperties(schema)
  const label = contractName ?? 'response'
  return Object.fromEntries(
    keys.map((key) => {
      const property = Object.hasOwn(properties, key) ? properties[key] : undefined
      if (!property) throw new Error(`The ${label} contract has no "${key}" property.`)
      return [key, property]
    }),
  )
}

/**
 * Every property of an object schema except the `omitted` ones. Throws when the schema is
 * recursive (`$defs`) or declares no object `properties`.
 */
export function omitSchemaProperties(
  schema: JsonSchema,
  omitted: readonly string[],
): Record<string, JsonSchema> {
  if (schema['$defs']) throw new Error('A recursive response contract cannot be nested.')
  const properties = schema['properties']
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    throw new TypeError('The schema has no object properties.')
  }
  const excluded = new Set(omitted)
  return Object.fromEntries(
    Object.entries(properties as Record<string, JsonSchema>).filter(([key]) => !excluded.has(key)),
  )
}
