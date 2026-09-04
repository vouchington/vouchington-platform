export interface UtmParserOptions {
  sourceAliases: Readonly<Record<string, string>>
  fallbackSourceParam?: string
}

export interface ExtractedUtmParams {
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  utmContent: string | null
}

export interface UtmParser {
  resolveSource(value: string): string
  extractFromUrl(url: URL): ExtractedUtmParams
}

/** Creates a UTM parser whose source aliases and fallback param are caller-owned. */
export function createUtmParser(options: UtmParserOptions): UtmParser {
  const sourceAliases: Record<string, string> = {}
  for (const [key, value] of Object.entries(options.sourceAliases)) {
    sourceAliases[key.toLowerCase().trim()] = value.toLowerCase().trim()
  }
  const fallbackSourceParam = options.fallbackSourceParam

  function resolveSource(value: string): string {
    const lower = value.toLowerCase().trim()
    return sourceAliases[lower] ?? lower
  }

  return {
    resolveSource,
    extractFromUrl(url) {
      const rawSource = url.searchParams.get('utm_source')
      const fallback =
        fallbackSourceParam === undefined ? null : url.searchParams.get(fallbackSourceParam)
      const normalizedSource = rawSource ? resolveSource(rawSource) || null : null
      const normalizedFallback = fallback ? resolveSource(fallback) || null : null
      const utmSource = normalizedSource ?? normalizedFallback
      return {
        utmSource,
        utmMedium: url.searchParams.get('utm_medium')?.toLowerCase().trim() || null,
        utmCampaign: url.searchParams.get('utm_campaign')?.toLowerCase().trim() || null,
        utmContent: url.searchParams.get('utm_content')?.toLowerCase().trim() || null,
      }
    },
  }
}
