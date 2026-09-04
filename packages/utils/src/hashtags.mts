const HASHTAG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export interface HashtagNormalizerOptions {
  maximumAuthoredLength: number
  maximumKeyLength: number
  separators: readonly string[]
}

export interface NormalizedHashtag {
  authored: string
  key: string
}

export interface HashtagNormalizer {
  normalize(input: string): NormalizedHashtag | null
  normalizeQuery(input: string): string
}

/** Creates an ASCII hashtag normalizer whose length and separator policy is caller-owned. */
export function createHashtagNormalizer(options: HashtagNormalizerOptions): HashtagNormalizer {
  assertLength(options.maximumAuthoredLength, 'maximumAuthoredLength')
  assertLength(options.maximumKeyLength, 'maximumKeyLength')
  const maximumAuthoredLength = options.maximumAuthoredLength
  const maximumKeyLength = options.maximumKeyLength
  const separatorPattern = createSeparatorPattern(options.separators)

  function normalizeQuery(input: string): string {
    const withoutPrefix = input.trim().replace(/^#/, '')
    const separated = separatorPattern
      ? withoutPrefix.replace(separatorPattern, '-')
      : withoutPrefix
    return separated.replace(/-+/g, '-').toLowerCase()
  }

  return {
    normalize(input) {
      const authored = input.trim()
      const key = normalizeQuery(authored)
      if (
        authored.length === 0 ||
        authored.length > maximumAuthoredLength ||
        key.length === 0 ||
        key.length > maximumKeyLength ||
        !HASHTAG_PATTERN.test(key)
      ) {
        return null
      }
      return { authored, key }
    },
    normalizeQuery,
  }
}

function assertLength(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError(`${name} must be a non-negative safe integer`)
}

function createSeparatorPattern(separators: readonly string[]): RegExp | null {
  const tokens = [...new Set(separators.filter((separator) => separator.length > 0))].sort(
    (left, right) => right.length - left.length,
  )
  if (tokens.length === 0) return null
  return new RegExp(`(?:${tokens.map(escapeRegularExpression).join('|')})+`, 'g')
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const absoluteUrlPrefix = /(?:https?:\/\/|www\.)/gi
const urlBoundary = /[\s<>]/

/**
 * Blanks absolute URLs and relative paths that contain `#` so fragment text is
 * not treated as a hashtag. Parentheses stay balanced for Wikipedia-style paths.
 */
export function maskHashtagBearingUrls(input: string): string {
  const masked = input.split('')

  for (const match of input.matchAll(absoluteUrlPrefix)) {
    const start = match.index!
    maskRange(masked, start, findUrlEnd(input, start))
  }

  for (let start = 0; start < input.length; start += 1) {
    if (input[start] !== '/') continue
    const end = findUrlEnd(input, start)
    if (input.slice(start, end).includes('#')) maskRange(masked, start, end)
    start = end - 1
  }

  return masked.join('')
}

function findUrlEnd(input: string, start: number): number {
  let parenthesisDepth = 0

  for (let index = start; index < input.length; index += 1) {
    const character = input[index]!
    if (urlBoundary.test(character)) return index
    if (character === '(') {
      parenthesisDepth += 1
      continue
    }
    if (character === ')') {
      if (parenthesisDepth === 0) return index
      parenthesisDepth -= 1
    }
  }

  return input.length
}

function maskRange(masked: string[], start: number, end: number): void {
  masked.fill(' ', start, end)
}
