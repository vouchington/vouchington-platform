/** Marketing and ad click-id parameters that never change response content. */
export const DEFAULT_NO_VARY_SEARCH_PARAM_NAMES: readonly string[] = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'gbraid',
  'wbraid',
  'dclid',
  'fbclid',
  'msclkid',
  'ttclid',
  'twclid',
  'srsltid',
  'igshid',
  'igsh',
  '_gl',
  'mc_cid',
  'mc_eid',
]

/**
 * Builds the canonical URL used as a platform-cache key: drops parameters that do not change the
 * response, then sorts the rest so key order never fragments the cache.
 */
export function normalizeCacheUrl(
  rawUrl: string,
  options: { stripParams?: Iterable<string> } = {},
): string {
  const url = new URL(rawUrl)
  for (const name of options.stripParams ?? DEFAULT_NO_VARY_SEARCH_PARAM_NAMES) {
    url.searchParams.delete(name)
  }
  url.searchParams.sort()
  return url.toString()
}
