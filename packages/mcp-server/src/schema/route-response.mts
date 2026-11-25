import type { JsonSchema, ToolApiEndpoint, ToolOutputSchema } from '../types.mts'

/** Named schemas an OpenAPI-style document keeps under `#/components/schemas/`. */
export type SchemaComponents = Record<string, JsonSchema>

/** Options for resolving a route's response contract into a standalone MCP output schema. */
export type ResolveRouteResponseOptions = {
  missingContractHint?: string
  /** Optional `#projection` suffix checked in `responses` before `fallbackResponses`. */
  projection?: string
  /** Secondary response table consulted by normalized `METHOD:path` when `responses` has no entry. */
  fallbackResponses?: Record<string, JsonSchema>
  /** Normalize `{param}` path placeholders to `:param` before lookup. Defaults to `false`. */
  normalizePathParams?: boolean
}

const COMPONENT_PREFIX = '#/components/schemas/'

function isObjectSchema(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const schema = value as JsonSchema
  if (schema['type'] === 'object') return true
  for (const union of ['anyOf', 'oneOf'] as const) {
    const branches = schema[union]
    if (Array.isArray(branches) && branches.length > 0 && branches.every(isObjectSchema)) {
      return true
    }
  }
  const intersection = schema['allOf']
  return Array.isArray(intersection) && intersection.some(isObjectSchema)
}

/**
 * Ensures `schema` always describes an object at the root — either `type: 'object'`, an
 * `anyOf`/`oneOf` whose branches are all objects, or an `allOf` containing an object branch — and
 * returns it with `type: 'object'` set for MCP output-schema compatibility.
 */
export function ensureObjectRootSchema(schema: JsonSchema, label?: string): ToolOutputSchema {
  if (!isObjectSchema(schema)) {
    throw new Error(label ? `${label} must be an object` : 'Schema must be an object')
  }
  return { ...schema, type: 'object' }
}

/**
 * The response schema of a tool's REST twin, self-contained for MCP clients.
 *
 * `responses` is keyed by `METHOD:path` (or `METHOD:path#projection` when `projection` is given).
 * A route without a response schema fails loudly, and `missingContractHint` is appended to that
 * message so the application can say where to fix it.
 */
export function resolveRouteResponse(
  { method, path }: ToolApiEndpoint,
  responses: Record<string, JsonSchema>,
  components: SchemaComponents,
  {
    missingContractHint,
    projection,
    fallbackResponses,
    normalizePathParams = false,
  }: ResolveRouteResponseOptions = {},
): ToolOutputSchema {
  const normalizedPath = normalizePathParams ? path.replaceAll(/\{([^}]+)\}/g, ':$1') : path
  const baseKey = `${method}:${normalizedPath}`
  const key = projection ? `${baseKey}#${projection}` : baseKey
  const response = Object.hasOwn(responses, key)
    ? responses[key]
    : fallbackResponses && Object.hasOwn(fallbackResponses, baseKey)
      ? fallbackResponses[baseKey]
      : undefined
  if (!response) {
    const hint = missingContractHint ? ` ${missingContractHint}` : ''
    throw new Error(`No checked-in response contract for ${key}.${hint}`)
  }
  const schema = inlineSchemaReferences(response, components)
  if (!isObjectSchema(schema)) {
    throw new Error(`The response contract for ${key} is not an object; MCP requires one.`)
  }
  return { ...schema, type: 'object' }
}

/**
 * Resolves a named `#/components/schemas/*` component into a self-contained schema. Rejects
 * recursive components whose `$defs` cannot be nested into another schema.
 */
export function resolveComponentSchema(name: string, components: SchemaComponents): JsonSchema {
  const schema = inlineSchemaReferences({ $ref: `${COMPONENT_PREFIX}${name}` }, components)
  if (schema['$defs']) throw new Error('A recursive response contract cannot be nested.')
  return schema
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
