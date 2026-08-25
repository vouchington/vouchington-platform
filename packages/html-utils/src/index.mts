import { decodeHTMLStrict } from 'entities'

const INVALID_NUMERIC_ENTITY = /&#(?:\d+|[xX][0-9a-fA-F]+);/g
// NUL cannot occur in valid HTML text and avoids collisions with decoded values.
// oxlint-disable-next-line no-control-regex -- NUL sentinel protects invalid entities.
const SENTINEL = /\u0000html-entity-(\d+)\u0000/g

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
  const protectedValue = value.replace(INVALID_NUMERIC_ENTITY, (match) => {
    const hex = match[2] === 'x' || match[2] === 'X'
    const point = hex
      ? Number.parseInt(match.slice(3, -1), 16)
      : Number.parseInt(match.slice(2, -1), 10)
    if (isValidCodePoint(point)) return match
    invalid.push(match)
    return `\u0000html-entity-${invalid.length - 1}\u0000`
  })
  return decodeHTMLStrict(protectedValue).replace(
    SENTINEL,
    (_, index: string) => invalid[Number(index)]!,
  )
}
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
