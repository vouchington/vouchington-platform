import type { JsonSchema, ToolOutputSchema } from '../types.mts'
import { rewriteRefs, scopedSchema } from './scoped-schema.mts'

export type OutputUnion = {
  /** One scoped output schema per distinct source output, in first-seen order. */
  branches: JsonSchema[]
  /** Scoped definitions shared by the branches, with identical bodies stored once. */
  definitions: JsonSchema
  /** The branch each option's output lives in. Options with equal outputs share a branch. */
  indexes: Map<string, number>
}

/**
 * Collapses the output schemas of merged options into one union. Identical schemas share a
 * branch and identical definitions share a name, so a merged tool does not repeat itself. Scope
 * prefixes follow the option's position, never the branch's.
 */
export function mergeOutputBranches(
  outputs: readonly { option: string; outputSchema: ToolOutputSchema }[],
): OutputUnion {
  const branches: JsonSchema[] = []
  const definitions: JsonSchema = {}
  const definitionByBody = new Map<string, string>()
  const seenSchemas = new Map<string, number>()
  const indexes = new Map<string, number>()
  for (const [index, { option, outputSchema }] of outputs.entries()) {
    const schemaKey = JSON.stringify(outputSchema)
    const existing = seenSchemas.get(schemaKey)
    indexes.set(option, existing ?? branches.length)
    if (existing !== undefined) continue
    seenSchemas.set(schemaKey, branches.length)
    const scoped = scopedSchema(outputSchema, index)
    const replacements = new Map<string, string>()
    for (const [name, definition] of Object.entries(scoped.definitions)) {
      const body = JSON.stringify(definition)
      const sameBody = definitionByBody.get(body)
      if (sameBody) replacements.set(name, sameBody)
      else {
        definitionByBody.set(body, name)
        definitions[name] = definition
      }
    }
    const rename = (name: string) => replacements.get(name) ?? name
    for (const name of Object.keys(scoped.definitions)) {
      if (Object.hasOwn(definitions, name))
        definitions[name] = rewriteRefs(definitions[name], rename)
    }
    branches.push(rewriteRefs(scoped.body, rename) as JsonSchema)
  }
  return { branches, definitions, indexes }
}
