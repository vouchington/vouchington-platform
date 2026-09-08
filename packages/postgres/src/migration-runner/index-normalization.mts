type Statement = Record<string, unknown>

export function normalizeIndex(
  value: Statement,
  target: { nspname: string; relname: string },
): string {
  const copy = structuredClone(value) as Statement
  copy.concurrent = false
  copy.if_not_exists = false
  copy.idxname = ''
  copy.accessMethod ??= 'btree'
  copy.relation = { relname: target.relname, schemaname: target.nspname }
  normalizeDefaults(copy)
  delete copy.whereClause
  return JSON.stringify(canonical(copy))
}

function normalizeDefaults(value: unknown): void {
  if (Array.isArray(value)) return value.forEach(normalizeDefaults)
  if (!value || typeof value !== 'object') return
  const record = value as Record<string, unknown>
  const definition = record.DefElem as Record<string, unknown> | undefined
  const integer = (definition?.arg as Record<string, unknown> | undefined)?.Integer as
    | Record<string, unknown>
    | undefined
  if (definition && typeof integer?.ival === 'number')
    definition.arg = { String: { sval: String(integer.ival) } }
  const element = record.IndexElem as Record<string, unknown> | undefined
  if (element?.ordering === 'SORTBY_DEFAULT') element.ordering = 'SORTBY_ASC'
  if (element?.nulls_ordering === 'SORTBY_NULLS_DEFAULT')
    element.nulls_ordering =
      element.ordering === 'SORTBY_DESC' ? 'SORTBY_NULLS_FIRST' : 'SORTBY_NULLS_LAST'
  Object.values(record).forEach(normalizeDefaults)
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== 'location')
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonical(child)]),
  )
}
