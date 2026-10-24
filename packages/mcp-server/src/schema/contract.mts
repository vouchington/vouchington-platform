import { mapSchema, visitSchema, type Schema } from './traversal.mts'

const closedInputs = new WeakMap<object, Schema>()
const factoredSchemas = new WeakMap<object, Schema>()

/** Close only objects with named fields; free-form JSON maps keep their own contract. */
export function closeDeclaredInputObjects(schema: Schema): Schema {
  const cached = closedInputs.get(schema)
  if (cached) return cached
  const closed = mapSchema(
    schema,
    (current) => {
      if (!('properties' in current)) return current
      return { ...current, additionalProperties: false }
    },
    true,
    true,
  )
  closedInputs.set(schema, closed)
  return closed
}

/** Hoist profitable repeated schema nodes into this schema's own `$defs`. */
export function factorToolSchema(schema: Schema): Schema {
  const cached = factoredSchemas.get(schema)
  if (cached) return cached
  let result = schema
  let index = 1
  while (true) {
    const occurrences = new Map<string, { count: number; node: Schema }>()
    visitSchema(
      result,
      (node, root) => {
        if (root || '$ref' in node) return
        const key = stableStringify(node)
        const entry = occurrences.get(key)
        if (entry) entry.count += 1
        else occurrences.set(key, { count: 1, node })
      },
      true,
      true,
    )
    const candidates = [...occurrences.entries()]
      .filter(([key, entry]) => entry.count > 1 && key.length > 40)
      .toSorted((a, b) => b[0].length * b[1].count - a[0].length * a[1].count)
    let next: Schema | null = null
    for (const [key, { node }] of candidates) {
      const defs = result['$defs'] as Schema | undefined
      const name = nextDefinitionName(defs, index)
      const ref = `#/$defs/${name}`
      const replaced = mapSchema(
        result,
        (current, root) => (!root && stableStringify(current) === key ? { $ref: ref } : current),
        true,
        false,
        true,
      )
      const trial = { ...replaced, $defs: { ...defs, [name]: node } }
      if (JSON.stringify(trial).length < JSON.stringify(result).length) {
        next = trial
        index += 1
        break
      }
    }
    if (!next) break
    result = next
  }
  factoredSchemas.set(schema, result)
  return result
}

function nextDefinitionName(defs: Schema | undefined, start: number): string {
  let index = start
  while (Object.hasOwn(defs ?? {}, `S${index}`)) index += 1
  return `S${index}`
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .toSorted(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'undefined'
}
