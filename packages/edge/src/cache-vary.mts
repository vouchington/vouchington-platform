export const DEFAULT_SAFE_CACHE_VARY_TOKENS: readonly string[] = [
  'Cookie',
  'Authorization',
  'Accept-Encoding',
]

/**
 * Returns canonical safe tokens, or null when the `Vary` value must not enter a shared cache
 * (any token outside `allowed`, including `*`). Tokens compare case-insensitively.
 */
export function parseSafeCacheVary(
  value: string | null,
  allowed: readonly string[] = DEFAULT_SAFE_CACHE_VARY_TOKENS,
): string[] | null {
  if (value === null) return []
  const canonicalByKey = new Map(allowed.map((token) => [token.toLowerCase(), token]))
  const tokens: string[] = []
  const seen = new Set<string>()
  for (const rawToken of value.split(',')) {
    const key = rawToken.trim().toLowerCase()
    if (!key) continue
    const canonical = canonicalByKey.get(key)
    if (!canonical) return null
    if (seen.has(key)) continue
    seen.add(key)
    tokens.push(canonical)
  }
  return tokens
}

/** Merges additions into a client-facing `Vary` value without respelling existing tokens. */
export function mergeClientVary(
  existing: string | null,
  additions: readonly string[],
): string | null {
  const existingTokens = existing?.split(',').map((token) => token.trim()) ?? []
  if (existingTokens.some((token) => token === '*')) return '*'
  const merged = existingTokens.filter(Boolean)
  const seen = new Set(merged.map((token) => token.toLowerCase()))
  for (const token of additions) {
    const key = token.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(token)
  }
  return merged.length > 0 ? merged.join(', ') : null
}
