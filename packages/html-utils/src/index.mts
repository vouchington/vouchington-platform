import { decodeHTMLStrict } from 'entities'

const INVALID_NUMERIC_ENTITY = /&#(?:\d+|[xX][0-9a-fA-F]+);/g
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
export function decodeHtmlEntities(value: string): string {
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
  let decoded = decodeHTMLStrict(protectedValue)
  for (const [index, entity] of invalid.entries())
    decoded = decoded.replaceAll(`${sentinelPrefix}${index}\u0000`, entity)
  return decoded
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
