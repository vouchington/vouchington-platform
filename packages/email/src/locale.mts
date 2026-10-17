import { normalizeLocale } from '@vouchington/localization'

/**
 * Resolves a requested locale against the caller's supported list. Matches the exact
 * canonical tag first, then the bare language subtag, then returns the fallback.
 */
export function resolveEmailLocale<TLocale extends string>(
  requested: string | null | undefined,
  supported: readonly TLocale[],
  fallback: TLocale,
): TLocale {
  if (requested === null || requested === undefined) return fallback
  const normalized = normalizeLocale(requested)
  if (normalized === null) return fallback
  const find = (tag: string) =>
    supported.find((candidate) => normalizeLocale(candidate)?.toLowerCase() === tag.toLowerCase())
  return find(normalized) ?? find(normalized.split('-', 1)[0]!) ?? fallback
}
