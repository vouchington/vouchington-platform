import { decodeHTMLStrict } from 'entities'

const INVALID_NUMERIC_ENTITY = /&#(?:\d+|[xX][0-9a-fA-F]+);/g
const NAMED_ENTITY = /&([A-Za-z][A-Za-z0-9]*);/g
const HTML_ELEMENT_TAG = /<(\/?)([A-Za-z][A-Za-z0-9.:-]*)(?=[\s/>])[^>]*>/g
const SELF_CLOSING_TAG = /\/\s*>$/
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
  const insensitive = options.caseInsensitiveNamedEntities ?? []
  const normalizedValue = protectedValue.replace(NAMED_ENTITY, (match, name: string) => {
    const normalized = name.toLowerCase()
    const selected = insensitive.find((candidate) => candidate.toLowerCase() === normalized)
    return selected === undefined ? match : `&${selected};`
  })
  let decoded = decodeHTMLStrict(normalizedValue)
  for (const [index, entity] of invalid.entries())
    decoded = decoded.replaceAll(`${sentinelPrefix}${index}\u0000`, entity)
  return decoded
}

/** Common HTML named entities callers may decode case-insensitively. */
export const HTML_LEGACY_CASE_INSENSITIVE_NAMED_ENTITIES = Object.freeze([
  'amp',
  'lt',
  'gt',
  'quot',
  'apos',
  'nbsp',
  'mdash',
  'ndash',
  'ldquo',
  'rdquo',
  'lsquo',
  'rsquo',
  'hellip',
  'trade',
  'copy',
  'reg',
  'bull',
  'middot',
  'deg',
  'pound',
  'euro',
  'cent',
  'times',
  'divide',
  'laquo',
  'raquo',
])

const CODE_ELEMENT_NAMES = ['code', 'pre'] as const

/** Performs a lightweight lexical check for positions inside selected HTML elements. */
export function isInsideHtmlElement(
  value: string,
  position: number,
  elementNames: readonly string[],
): boolean {
  const depths = elementNames.map(() => 0)
  for (const match of value.matchAll(HTML_ELEMENT_TAG)) {
    if (match.index + match[0].length > position) break
    const elementIndex = elementNames.indexOf(match[2]!)
    if (elementIndex < 0 || !elementNames[elementIndex]) continue
    if (match[1] === '/') depths[elementIndex] = Math.max(0, depths[elementIndex]! - 1)
    else if (!SELF_CLOSING_TAG.test(match[0])) depths[elementIndex]! += 1
  }
  return depths.some((depth) => depth > 0)
}
/** Performs a lightweight lexical check; it does not parse malformed HTML or literal angle brackets. */
export function isInsideHtmlTag(value: string, position: number): boolean {
  const open = value.lastIndexOf('<', position)
  return open >= 0 && value.lastIndexOf('>', position) < open && value.indexOf('>', open) > position
}

/** Convenience check for positions inside `<code>` or `<pre>` elements. */
export function isInsideCode(value: string, position: number): boolean {
  return isInsideHtmlElement(value, position, CODE_ELEMENT_NAMES)
}
function isValidCodePoint(point: number): boolean {
  return (
    point > 0 &&
    point <= 0x10_ffff &&
    !(point >= 0xd800 && point <= 0xdfff) &&
    !((point >= 1 && point <= 0x1f) || (point >= 0x7f && point <= 0x9f))
  )
}
