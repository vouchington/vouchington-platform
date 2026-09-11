import { CANONICAL_SOURCE_LOCALE, ENGLISH_LOCALE_ALIAS } from './types.mts'

const LANGUAGE_TAG = /^[A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8})*$/

export function canonicalizeLocale(value: string): string | null {
  const trimmed = value.trim().replaceAll('_', '-')
  if (!LANGUAGE_TAG.test(trimmed)) return null
  try {
    return Intl.getCanonicalLocales(trimmed)[0] ?? null
  } catch {
    return null
  }
}

/** Maps `en` onto `en-US` after Unicode canonicalization. */
export function aliasEnglishLocale(value: string): string {
  return value === ENGLISH_LOCALE_ALIAS ? CANONICAL_SOURCE_LOCALE : value
}

export function normalizeLocale(value: string): string | null {
  const canonical = canonicalizeLocale(value)
  return canonical === null ? null : aliasEnglishLocale(canonical)
}

export function normalizeLocaleList(
  values: readonly string[],
  available: readonly string[] | null = null,
): string[] {
  const allowed = available === null ? null : new Set(available.map(aliasEnglishLocale))
  const locales: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const locale = normalizeLocale(value)
    if (locale === null) throw new TypeError(`Invalid locale "${value}"`)
    if (allowed !== null && !allowed.has(locale)) continue
    if (seen.has(locale)) continue
    seen.add(locale)
    locales.push(locale)
  }
  return locales
}
