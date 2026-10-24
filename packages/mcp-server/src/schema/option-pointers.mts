type Schema = Record<string, unknown>

/** Refuse incomplete mappings or pointers that no longer resolve after schema factoring. */
export function validateOptionOutputPointers(
  name: string,
  inputSchema: Schema,
  outputSchema: Schema | undefined,
  pointers: Readonly<Record<string, string>>,
): void {
  const branches = inputSchema['oneOf']
  if (!Array.isArray(branches) || !branches.length)
    throw new Error(`${name}: selected output pointers need literal input options`)
  const options = branches.map((branch) => {
    const properties = (branch as Schema)['properties'] as Record<string, Schema> | undefined
    const values = properties?.['option']?.['enum']
    if (!Array.isArray(values) || values.length !== 1 || typeof values[0] !== 'string')
      throw new Error(`${name}: selected output pointers need literal input options`)
    return values[0] as string
  })
  const keys = Object.keys(pointers)
  if (
    keys.length !== options.length ||
    new Set(options).size !== options.length ||
    options.some((option) => !Object.hasOwn(pointers, option))
  )
    throw new Error(`${name}: selected output pointers must cover exactly the input options`)
  for (const pointer of Object.values(pointers)) {
    if (!outputSchema || !isOutputPointer(outputSchema, pointer))
      throw new Error(`${name}: selected output pointer does not resolve in outputSchema`)
  }
}

/** Select within the output namespace, retaining its definitions for nested local references. */
export function getOptionOutputSchema(outputSchema: Schema, pointer: string): Schema {
  if (!isOutputPointer(outputSchema, pointer)) throw new Error('Invalid selected output pointer')
  if (pointer === '#') return outputSchema
  const branches = outputSchema['anyOf'] as Schema[]
  return {
    ...branches[Number(pointer.slice('#/anyOf/'.length))],
    $defs: outputSchema['$defs'] ?? {},
  }
}

function isOutputPointer(outputSchema: Schema, pointer: string): boolean {
  if (pointer === '#') return true
  if (!/^#\/anyOf\/(0|[1-9]\d*)$/.test(pointer)) return false
  const branches = outputSchema['anyOf']
  if (!Array.isArray(branches)) return false
  const branch: unknown = branches[Number(pointer.slice('#/anyOf/'.length))]
  return branch !== null && typeof branch === 'object' && !Array.isArray(branch)
}
