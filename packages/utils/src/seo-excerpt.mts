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

function stripMarkup(value: string): string {
  const withoutTags = value.replace(/<\/?[A-Za-z][^>]*>/g, ' ')
  const withoutLinks = withoutTags.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
  const withoutSyntax = withoutLinks.replace(/^\s{0,3}(#{1,6}|>)\s+/gm, '').replace(/[*_`~]+/g, ' ')
  return decodeEntities(withoutSyntax).replace(/\s+/g, ' ').trim()
}

/** Plain-text excerpt: strips HTML tags and light Markdown, decodes entities, truncates by code point. */
export function createExcerpt(value: string, maxLength: number = 160): string {
  const plainText = stripMarkup(value)
  const points = Array.from(plainText)
  if (points.length <= maxLength) return plainText
  return `${points
    .slice(0, maxLength - 1)
    .join('')
    .trimEnd()}…`
}
