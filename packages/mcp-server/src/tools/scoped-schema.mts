import type { JsonSchema } from '../types.mts'

/** Moves a schema's `$defs` under an `Option{index}_` prefix so merged options cannot collide. */
export function scopedSchema(schema: JsonSchema, index: number) {
  const prefix = `Option${index}_`
  const definitions = schema['$defs'] as JsonSchema | undefined
  const { $defs: _definitions, ...body } = schema
  return {
    body: rewriteRefs(body, (name) => `${prefix}${name}`) as JsonSchema,
    definitions: Object.fromEntries(
      Object.entries(definitions ?? {}).map(([key, value]) => [
        `${prefix}${key}`,
        rewriteRefs(value, (name) => `${prefix}${name}`),
      ]),
    ) as JsonSchema,
  }
}

/** Rewrites every `#/$defs/<name>` reference to `#/$defs/<rename(name)>`. */
export function rewriteRefs(value: unknown, rename: (name: string) => string): unknown {
  if (Array.isArray(value)) return value.map((item) => rewriteRefs(item, rename))
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      key === '$ref' && typeof item === 'string' && item.startsWith('#/$defs/')
        ? `#/$defs/${rename(item.slice('#/$defs/'.length))}`
        : rewriteRefs(item, rename),
    ]),
  )
}
