const LOWERCASE = new Set([
  'a',
  'an',
  'the',
  'and',
  'but',
  'or',
  'nor',
  'for',
  'yet',
  'so',
  'at',
  'by',
  'in',
  'of',
  'on',
  'to',
  'up',
  'as',
  'is',
  'if',
  'it',
  'via',
  'vs',
  'with',
  'from',
  'into',
  'over',
  'upon',
  'than',
  'that',
  'then',
])
export function toTitleCase(value: string): string {
  const words = value.split(/\s+/)
  return words
    .map((word, index) => {
      if (word.length <= 4 && word === word.toUpperCase()) return word
      const lower = word.toLowerCase()
      if (index > 0 && index < words.length - 1 && LOWERCASE.has(lower)) return lower
      return `${word.charAt(0).toUpperCase()}${lower.slice(1)}`
    })
    .join(' ')
}
export function normalizeKey(value: string): string {
  return value.trim().toLowerCase()
}
export function stripControlCharacters(value: string): string {
  // oxlint-disable-next-line no-control-regex -- this explicitly filters unsupported C0 controls and DEL.
  return value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
}
