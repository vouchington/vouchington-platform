import type { JsonSchema, ToolApiEndpoint, ToolOutputSchema } from '../types.mts'

/** Named schemas an OpenAPI-style document keeps under `#/components/schemas/`. */
export type SchemaComponents = Record<string, JsonSchema>

const COMPONENT_PREFIX = '#/components/schemas/'

/**
 * The response schema of a tool's REST twin, self-contained for MCP clients.
 *
 * `responses` is keyed by `METHOD:path`. A route without a response schema fails loudly, and
 * `missingContractHint` is appended to that message so the application can say where to fix it.
 */
export function resolveRouteResponse(
  { method, path }: ToolApiEndpoint,
  responses: Record<string, JsonSchema>,
  components: SchemaComponents,
  { missingContractHint }: { missingContractHint?: string } = {},
): ToolOutputSchema {
  const key = `${method}:${path}`
  const response = responses[key]
  if (!response) {
    const hint = missingContractHint ? ` ${missingContractHint}` : ''
    throw new Error(`No checked-in response contract for ${key}.${hint}`)
  }
  const schema = inlineSchemaReferences(response, components)
  if (schema['type'] !== 'object') {
    throw new Error(`The response contract for ${key} is not an object; MCP requires one.`)
  }
  return { ...schema, type: 'object' }
}

/**
 * Inlines every `#/components/schemas/*` reference so the result needs no document around it. A
 * component that refers back to itself stays a `$ref` into a root `$defs`, so recursive contracts
 * still terminate.
 */
export function inlineSchemaReferences(
  schema: JsonSchema,
  components: SchemaComponents,
): JsonSchema {
  const defs: SchemaComponents = {}
  const inlined = inline(schema, [], defs, components) as JsonSchema
  return Object.keys(defs).length > 0 ? { ...inlined, $defs: defs } : inlined
}

/** A property of an object schema, for a tool that reshapes the REST body into its own result. */
export function routePropertySchema(schema: ToolOutputSchema, property: string): JsonSchema {
  if (schema['$defs']) throw new Error('A recursive response contract cannot be nested.')
  const found = (schema['properties'] as SchemaComponents | undefined)?.[property]
  if (!found) throw new Error(`The response contract has no "${property}" property.`)
  return found
}

/** The `{ success: true, result }` envelope the list tools wrap around a REST body. */
export function successResultSchema(result: ToolOutputSchema): ToolOutputSchema {
  const { $defs, ...body } = result
  return {
    type: 'object',
    properties: { success: { const: true }, result: body },
    required: ['success', 'result'],
    additionalProperties: false,
    ...($defs ? { $defs } : {}),
  }
}

function inline(
  value: unknown,
  ancestors: string[],
  defs: SchemaComponents,
  components: SchemaComponents,
): unknown {
  if (Array.isArray(value)) return value.map((item) => inline(item, ancestors, defs, components))
  if (!value || typeof value !== 'object') return value
  const { $ref, ...siblings } = value as JsonSchema
  const inlinedSiblings = Object.fromEntries(
    Object.entries(siblings).map(([keyword, child]) => [
      keyword,
      inline(child, ancestors, defs, components),
    ]),
  )
  if (typeof $ref !== 'string') return inlinedSiblings
  const name = $ref.startsWith(COMPONENT_PREFIX) ? $ref.slice(COMPONENT_PREFIX.length) : ''
  const target = Object.hasOwn(components, name) ? components[name] : undefined
  if (!target) throw new Error(`Unresolvable response contract reference ${$ref}`)
  if (!ancestors.includes(name)) {
    const inlinedTarget = inline(target, [...ancestors, name], defs, components)
    return { ...(inlinedTarget as JsonSchema), ...inlinedSiblings }
  }
  if (!Object.hasOwn(defs, name)) {
    defs[name] = {}
    defs[name] = inline(target, [name], defs, components) as JsonSchema
  }
  return { ...inlinedSiblings, $ref: `#/$defs/${name}` }
}
