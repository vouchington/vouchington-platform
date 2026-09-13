import {
  CANONICAL_SOURCE_LOCALE,
  ENGLISH_LOCALE_ALIAS,
  catalogCopyFromRecord,
  compareCodePoints,
  consumerAliasFromRecord,
  isMessageId,
  normalizeLocale,
  routeSelectorMembershipFromRecord,
  translationRowFromRecord,
  type LocalizationCatalog,
  type TranslationValue,
} from '@vouchington/localization'
import { validateCatalogMessages } from './validate.mts'

export function validateLocalizationCatalog(catalog: LocalizationCatalog): void {
  const copies = new Map(catalog.copies.map((copy) => [copy.id, copy]))
  if (copies.size !== catalog.copies.length) throw new TypeError('Duplicate copy id')
  const aliases = new Set<string>()
  for (const raw of catalog.aliases) {
    const alias = consumerAliasFromRecord(raw)
    if (!copies.has(alias.copyId))
      throw new TypeError(`Alias "${alias.alias}" targets missing copy "${alias.copyId}"`)
    const key = `${alias.consumer}\t${alias.alias}`
    if (aliases.has(key))
      throw new TypeError(`Duplicate alias "${alias.alias}" for ${alias.consumer}`)
    aliases.add(key)
  }
  const translated = new Map<string, Map<string, TranslationValue>>()
  for (const [locale, rows] of Object.entries(catalog.translations)) {
    const normalized = normalizeLocale(locale)
    if (normalized === null || locale === ENGLISH_LOCALE_ALIAS || locale !== normalized) {
      throw new TypeError(`Locale "${locale}" must be stored as ${normalized}`)
    }
    const values = new Map<string, TranslationValue>()
    for (const raw of rows) {
      const row = translationRowFromRecord(raw)
      if (!copies.has(row.id)) throw new TypeError(`Translation targets missing copy "${row.id}"`)
      if (values.has(row.id))
        throw new TypeError(`Duplicate translation for "${row.id}" in ${locale}`)
      values.set(row.id, row.value)
    }
    translated.set(locale, values)
  }
  const english = translated.get(CANONICAL_SOURCE_LOCALE)
  for (const copy of copies.values()) {
    if (!english?.has(copy.id))
      throw new TypeError(`Copy "${copy.id}" is missing ${CANONICAL_SOURCE_LOCALE}`)
  }
  validateCatalogMessages(
    [...copies.values()].map((copy) => ({
      ...copy,
      consumers: ['web'],
      translations: Object.fromEntries(
        [...translated.entries()].flatMap(([locale, rows]) =>
          rows.has(copy.id) ? [[locale, rows.get(copy.id)!]] : [],
        ),
      ),
    })),
  )
  const membership = new Set<string>()
  for (const raw of catalog.routeMembership ?? []) {
    const row = routeSelectorMembershipFromRecord(raw)
    if (!aliases.has(`${row.consumer}\t${row.alias}`)) {
      throw new TypeError(`Route selector "${row.selectorId}" targets missing alias "${row.alias}"`)
    }
    const key = `${row.consumer}\t${row.selectorId}\t${row.alias}`
    if (membership.has(key))
      throw new TypeError(`Duplicate route membership "${row.selectorId}" → "${row.alias}"`)
    membership.add(key)
  }
  for (const id of Object.keys(catalog.tags ?? {}))
    if (!copies.has(id) || !isMessageId(id))
      throw new TypeError(`Editorial tag target "${id}" is not in the catalog`)
}

export function sortedCatalog(catalog: LocalizationCatalog): LocalizationCatalog {
  validateLocalizationCatalog(catalog)
  return {
    copies: [...catalog.copies].toSorted((a, b) => compareCodePoints(a.id, b.id)),
    aliases: [...catalog.aliases].toSorted((a, b) =>
      compareCodePoints(`${a.consumer}\t${a.alias}`, `${b.consumer}\t${b.alias}`),
    ),
    translations: Object.fromEntries(
      Object.entries(catalog.translations).map(([locale, rows]) => [
        locale,
        [...rows].toSorted((a, b) => compareCodePoints(a.id, b.id)),
      ]),
    ),
    routeMembership: [...(catalog.routeMembership ?? [])].toSorted((a, b) =>
      compareCodePoints(
        `${a.consumer}\t${a.selectorId}\t${a.alias}`,
        `${b.consumer}\t${b.selectorId}\t${b.alias}`,
      ),
    ),
    tags: catalog.tags ?? {},
  }
}
