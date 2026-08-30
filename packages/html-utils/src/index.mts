import { decodeHTMLStrict } from 'entities'

const INVALID_NUMERIC_ENTITY = /&#(?:\d+|[xX][0-9a-fA-F]+);/g
const NAMED_ENTITY = /&([A-Za-z][A-Za-z0-9]*);/g
export interface DecodeHtmlEntitiesOptions {
  caseInsensitiveNamedEntities?: readonly string[]
}
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
export function decodeHtmlEntities(value: string, options: DecodeHtmlEntitiesOptions = {}): string {
  if (!value.includes('&')) return value
  const invalid: string[] = []
  let sentinelPrefix = '\u0000html-entity-'
  while (value.includes(sentinelPrefix)) sentinelPrefix += '-'
  const protectedValue = value.replace(INVALID_NUMERIC_ENTITY, (match) => {
    const hex = match[2] === 'x' || match[2] === 'X'
    const point = hex
      ? Number.parseInt(match.slice(3, -1), 16)
      : Number.parseInt(match.slice(2, -1), 10)
    if (isValidCodePoint(point)) return match
    invalid.push(match)
    return `${sentinelPrefix}${invalid.length - 1}\u0000`
  })
  const insensitive = new Set(
    options.caseInsensitiveNamedEntities?.map((name) => name.toLowerCase()) ?? [],
  )
  const normalizedValue = protectedValue.replace(NAMED_ENTITY, (match, name: string) => {
    const normalized = name.toLowerCase()
    return insensitive.has(normalized) ? `&${normalized};` : match
  })
  let decoded = decodeHTMLStrict(normalizedValue)
  for (const [index, entity] of invalid.entries())
    decoded = decoded.replaceAll(`${sentinelPrefix}${index}\u0000`, entity)
  return decoded
}

/** Performs a lightweight lexical check for positions inside selected HTML elements. */
export function isInsideHtmlElement(
  value: string,
  position: number,
  elementNames: readonly string[],
): boolean {
  const before = value.slice(0, position)
  return elementNames.some((name) => {
    if (!name) return false
    const escapedName = escapeRegularExpression(name)
    return (
      lastMatchIndex(before, new RegExp(`<${escapedName}(?=[\\s/>])`, 'g')) >
      lastMatchIndex(before, new RegExp(`</${escapedName}\\s*>`, 'g'))
    )
  })
}

function lastMatchIndex(value: string, pattern: RegExp): number {
  let result = -1
  for (const match of value.matchAll(pattern)) result = match.index
  return result
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
/** Performs a lightweight lexical check; it does not parse malformed HTML or literal angle brackets. */
export function isInsideHtmlTag(value: string, position: number): boolean {
  const open = value.lastIndexOf('<', position)
  return open >= 0 && value.lastIndexOf('>', position) < open && value.indexOf('>', open) > position
}
function isValidCodePoint(point: number): boolean {
  return (
    point > 0 &&
    point <= 0x10_ffff &&
    !(point >= 0xd800 && point <= 0xdfff) &&
    !((point >= 1 && point <= 0x1f) || (point >= 0x7f && point <= 0x9f))
  )
}
