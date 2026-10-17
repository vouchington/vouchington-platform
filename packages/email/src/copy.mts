import {
  aliasEnglishLocale,
  firstAvailableTranslation,
  leafForTranslation,
  type CatalogMessage,
  type LocalizationLeaf,
} from '@vouchington/localization'
import { formatLocalizationLeaf } from './format.mts'
import type { EmailTranslator } from './types.mts'

export type EmailLeaves = Readonly<Record<string, LocalizationLeaf>>

/** Resolves catalog messages to leaves for one locale, falling back to en-US. */
export function leavesFromCatalog(
  messages: readonly CatalogMessage[],
  locale: string,
): Record<string, LocalizationLeaf> {
  const locales = locale === 'en' ? ['en-US'] : [aliasEnglishLocale(locale), 'en-US']
  const leaves: Record<string, LocalizationLeaf> = {}
  for (const message of messages) {
    const value = firstAvailableTranslation(locales, message.translations)
    if (value === undefined) continue
    leaves[message.id] = leafForTranslation(message.descriptor, value)
  }
  return leaves
}

/**
 * Builds a translator over already-resolved leaves, scoped to `email.<family>.`.
 * The caller supplies the leaves (JSON catalog, SQLite batch, or otherwise) and owns caching.
 */
export function createEmailTranslator(
  leaves: EmailLeaves,
  locale: string,
  family: string,
): EmailTranslator {
  const prefix = `email.${family}.`
  return (key, vars) => {
    const id = `${prefix}${key}`
    const leaf = leaves[id]
    if (leaf === undefined) throw new TypeError(`Missing email message "${id}"`)
    return formatLocalizationLeaf(leaf, locale, vars)
  }
}

/** Uses `<key>.unnamed` when the value is empty, otherwise `<key>` with the value bound. */
export function emailOptional(
  translate: EmailTranslator,
  key: string,
  value: string | undefined,
  param = 'userName',
): string {
  return value === undefined || value.length === 0
    ? translate(`${key}.unnamed`)
    : translate(key, { [param]: value })
}
