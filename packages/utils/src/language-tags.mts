export type ParsedLanguageRange = Readonly<{
  range: string
  quality: number
  index: number
}>
type SupportedLanguage<Supported extends string> = Readonly<{
  original: Supported
  canonical: string
}>

const HTTP_LANGUAGE_RANGE = /^(?:\*|[A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8})*)$/
const QUALITY = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/

/** Normalizes a locale against the caller's exact supported-tag catalog. */
export function normalizeLanguageTag<Supported extends string>(
  value: string | null | undefined,
  supported: readonly Supported[],
): Supported | null {
  if (!value) return null
  const canonical = canonicalize(value.trim().replaceAll('_', '-'))
  return canonical === null ? null : lookup(canonical, validSupported(supported))
}

/** Parses valid, non-zero Accept-Language ranges, highest quality first and stably for ties. */
export function parseAcceptLanguage(value: string | null | undefined): ParsedLanguageRange[] {
  return parseLanguageRanges(value).filter((parsed) => parsed.quality > 0)
}

/** Returns the caller-configured supported tag selected by strict Accept-Language lookup. */
export function bestAcceptLanguageMatch<Supported extends string>(
  value: string | null | undefined,
  supported: readonly Supported[],
): Supported | null {
  const available = validSupported(supported)
  const parsed = parseLanguageRanges(value)
  for (const range of parsed) {
    if (range.quality === 0) continue
    if (range.range === '*')
      return available.find((tag) => !isExcluded(tag.canonical, parsed))?.original ?? null
    const match = lookup(range.range, available, parsed)
    if (match !== null) return match
  }
  return null
}

function parseLanguageRanges(value: string | null | undefined): ParsedLanguageRange[] {
  if (!value) return []
  return value
    .split(',')
    .flatMap((part, index) => {
      const [range, ...parameters] = part
        .trim()
        .split(';')
        .map((item) => item.trim())
      if (!range || !HTTP_LANGUAGE_RANGE.test(range)) return []
      const quality = parameters.length === 0 ? 1 : parseQuality(parameters)
      const canonical = range === '*' ? '*' : canonicalize(range)
      return canonical === null || quality === null ? [] : [{ range: canonical, quality, index }]
    })
    .toSorted((left, right) => right.quality - left.quality || left.index - right.index)
}

function parseQuality(parameters: readonly string[]): number | null {
  if (parameters.length !== 1) return null
  const matched = /^q=(.+)$/i.exec(parameters[0]!)
  if (!matched || !QUALITY.test(matched[1]!)) return null
  return Number(matched[1])
}

function canonicalize(value: string): string | null {
  try {
    return Intl.getCanonicalLocales(value)[0]!
  } catch {
    return null
  }
}

function lookup<Supported extends string>(
  range: string,
  supported: readonly SupportedLanguage<Supported>[],
  parsed: readonly ParsedLanguageRange[] = [],
): Supported | null {
  let candidate = range
  while (candidate) {
    for (const tag of supported) {
      if (tag.canonical === candidate && !isExcluded(candidate, parsed)) return tag.original
    }
    const separator = candidate.lastIndexOf('-')
    candidate = separator > 1 ? candidate.slice(0, separator) : ''
  }
  return null
}

function validSupported<Supported extends string>(
  supported: readonly Supported[],
): readonly SupportedLanguage<Supported>[] {
  return supported.flatMap((original) => {
    const canonical = canonicalize(original)
    return canonical === null ? [] : [{ original, canonical }]
  })
}

function isExcluded(canonical: string, parsed: readonly ParsedLanguageRange[]): boolean {
  const matching = parsed.filter((range) => matchesRange(range.range, canonical))
  const specificity = Math.max(...matching.map((range) => rangeSpecificity(range.range)))
  return matching.some(
    (range) => range.quality === 0 && rangeSpecificity(range.range) === specificity,
  )
}

function rangeSpecificity(range: string): number {
  return range === '*' ? 0 : range.split('-').length
}

function matchesRange(range: string, candidate: string): boolean {
  return range === '*' || candidate === range || candidate.startsWith(`${range}-`)
}
