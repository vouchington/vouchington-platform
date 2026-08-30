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
