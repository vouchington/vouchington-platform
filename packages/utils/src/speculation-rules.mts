export interface SpeculationRulesConfig {
  excludedHrefPatterns: readonly string[]
  excludedSelectors?: readonly string[]
  /** Value for `expects_no_vary_search`; omitted when undefined. */
  noVarySearchHeader?: string
  eagerness?: 'immediate' | 'eager' | 'moderate' | 'conservative'
}

/** Builds a prefetch speculation-rules object. Serialize it with `serializeJsonLd`-style escaping. */
export function createSpeculationRules(config: SpeculationRulesConfig): Record<string, unknown> {
  return {
    prefetch: [
      {
        source: 'document',
        where: {
          and: [
            { href_matches: '/*' },
            ...config.excludedHrefPatterns.map((pattern) => ({ not: { href_matches: pattern } })),
            ...(config.excludedSelectors ?? []).map((selector) => ({
              not: { selector_matches: selector },
            })),
          ],
        },
        eagerness: config.eagerness ?? 'conservative',
        ...(config.noVarySearchHeader ? { expects_no_vary_search: config.noVarySearchHeader } : {}),
      },
    ],
  }
}

/** Returns the origin of an http(s) URL, or null. */
export function getPreconnectOrigin(rawOrigin: string | undefined): string | null {
  const trimmed = rawOrigin?.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return url.origin
  } catch {
    return null
  }
}
