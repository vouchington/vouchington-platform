const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] !== '#') return NAMED_ENTITIES[body.toLowerCase()] ?? match
    const code = /^#x/i.test(body) ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
  })
}

// Paired markers only, opening at a word start and closing at a word end, so `snake_case`
// and `5*3` survive.
const PAIRED_MARKER =
  /(?<![\p{L}\p{N}])(\*{1,3}|_{1,3}|~~)(?=\S)([^\n]+?)(?<=\S)\1(?![\p{L}\p{N}])/gu

function stripMarkers(value: string): string {
  let current = value.replace(/`([^`\n]+)`/g, '$1')
  for (let previous = ''; previous !== current;) {
    previous = current
    current = current.replace(PAIRED_MARKER, '$2')
  }
  return current
}

function stripMarkup(value: string): string {
  const withoutTags = value.replace(/<\/?[A-Za-z](?:"[^"]*"|'[^']*'|[^'">])*>/g, ' ')
  const withoutLinks = withoutTags.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
  const withoutSyntax = withoutLinks.replace(/^\s{0,3}(#{1,6}|>)\s+/gm, '')
  return decodeEntities(stripMarkers(withoutSyntax)).replace(/\s+/g, ' ').trim()
}

/** Plain-text excerpt: strips HTML tags and light Markdown, decodes entities, truncates by code point. */
export function createExcerpt(value: string, maxLength: number = 160): string {
  if (!(maxLength >= 1)) return ''
  const plainText = stripMarkup(value)
  const points = Array.from(plainText)
  if (points.length <= maxLength) return plainText
  return `${points
    .slice(0, maxLength - 1)
    .join('')
    .trimEnd()}…`
}
