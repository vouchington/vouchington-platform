import type { JsonSchema, ToolOutputSchema } from '../types.mts'

/** An object that holds exactly these properties. Every one is required unless `optional` names it. */
export function objectSchema(
  properties: Record<string, JsonSchema>,
  optional: readonly string[] = [],
): ToolOutputSchema {
  return {
    type: 'object',
    properties,
    required: Object.keys(properties).filter((name) => !optional.includes(name)),
    additionalProperties: false,
  }
}

/** The `{ success: true, ...properties }` result of a tool that has no failure result. */
export function successSchema(
  properties: Record<string, JsonSchema>,
  optional: readonly string[] = [],
): ToolOutputSchema {
  return objectSchema({ success: { const: true }, ...properties }, optional)
}

/** A result that is exactly one of several object shapes. MCP still wants an object at the root. */
export function oneOfSchema(...variants: ToolOutputSchema[]): ToolOutputSchema {
  return { type: 'object', oneOf: variants }
}

/**
 * The result of a lookup tool that reports an unresolvable input as a normal result (for example
 * "Topic not found") instead of throwing. The schema has to admit that branch next to the success
 * shape, or every miss would fail output validation. `flag` is the discriminating field the tool
 * sets on both branches.
 */
export function outcomeSchema(
  flag: 'success' | 'found',
  properties: Record<string, JsonSchema>,
  optional: readonly string[] = [],
): ToolOutputSchema {
  return oneOfSchema(
    objectSchema({ [flag]: { const: true }, ...properties }, optional),
    objectSchema({ [flag]: { const: false }, error: { type: 'string' } }),
  )
}

// Null comes first because that is how the generated OpenAPI document spells a nullable value, so a
// nullable field copied from a route compares equal to one written here.
export const nullable = (schema: JsonSchema): JsonSchema => ({ anyOf: [{ type: 'null' }, schema] })
