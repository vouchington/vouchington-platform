export function stableJsonStringify(value: unknown): string {
  return `${format(sort(value))}\n`
}
function sort(value: unknown): unknown {
  if (hasToJson(value)) return sort(value.toJSON())
  if (Array.isArray(value)) return value.map((item) => (item === undefined ? null : sort(item)))
  if (value === undefined) return null
  if (value == null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, nested]) => nested !== undefined)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sort(nested)]),
  )
}
function hasToJson(value: unknown): value is { toJSON(): unknown } {
  return (
    value != null &&
    typeof value === 'object' &&
    typeof (value as { toJSON?: unknown }).toJSON === 'function'
  )
}
function format(value: unknown, indent = 0, prefix = 0): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    const inline = `[${value.map((item) => JSON.stringify(item)).join(', ')}]`
    if (
      value.every(
        (item) => item == null || ['boolean', 'number', 'string'].includes(typeof item),
      ) &&
      inline.length <= 100 - indent - prefix
    )
      return inline
    const child = ' '.repeat(indent + 2)
    return `[\n${value.map((item) => `${child}${format(item, indent + 2)}`).join(',\n')}\n${' '.repeat(indent)}]`
  }
  if (value == null || typeof value !== 'object') return JSON.stringify(value)
  const entries = Object.entries(value)
  if (!entries.length) return '{}'
  const child = ' '.repeat(indent + 2)
  return `{\n${entries
    .map(([key, nested]) => {
      const serialized = JSON.stringify(key)
      return `${child}${serialized}: ${format(nested, indent + 2, serialized.length + 2)}`
    })
    .join(',\n')}\n${' '.repeat(indent)}}`
}
