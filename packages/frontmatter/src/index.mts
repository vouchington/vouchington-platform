import { Scalar, stringify } from 'yaml'

const KEYWORD = /^(true|false|null|yes|no|on|off)$/i
const NEEDS_QUOTING = /[:\n\r\t#"']/
// oxlint-disable-next-line no-control-regex -- YAML cannot represent raw controls safely.
const CONTROL = /[\x00-\x1f]/

export function toFrontmatter(fields: Record<string, unknown>): string {
  const normalized = normalizeFields(fields)
  if (Object.keys(normalized).length === 0) return '---\n---'
  const content = stringify(normalized, { lineWidth: 0 }).trimEnd()
  return `---\n${content}\n---`
}
function normalizeFields(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).flatMap(([key, value]) => {
      const normalized = normalizeItem(value)
      return normalized === undefined ? [] : [[key, normalized]]
    }),
  )
}
function normalizeItem(value: unknown): unknown {
  if (value == null) return undefined
  if (Array.isArray(value)) {
    const items = value.flatMap((item) => {
      const normalized = normalizeItem(item)
      return normalized === undefined ? [] : [normalized]
    })
    return items.length ? items : undefined
  }
  if (typeof value === 'object' && !(value instanceof Date)) {
    const entries = Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => {
      const normalized = normalizeItem(item)
      return normalized === undefined ? [] : [[key, normalized]]
    })
    return entries.length ? Object.fromEntries(entries) : undefined
  }
  return normalizeScalar(value)
}
function normalizeScalar(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (typeof value !== 'string')
    return typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint'
      ? value
      : String(value)
  if (!needsQuoting(value)) return value
  const scalar = new Scalar(value)
  scalar.type = Scalar.QUOTE_DOUBLE
  return scalar
}
function needsQuoting(value: string): boolean {
  return (
    value === '' ||
    KEYWORD.test(value) ||
    (value.trim() !== '' && Number.isFinite(Number(value))) ||
    NEEDS_QUOTING.test(value) ||
    value.startsWith('-') ||
    value.startsWith('[') ||
    value.startsWith('{') ||
    CONTROL.test(value)
  )
}
