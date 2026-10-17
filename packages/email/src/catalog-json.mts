import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  catalogCopyFromRecord,
  consumerAliasFromRecord,
  translationRowFromRecord,
  type CatalogCopy,
  type CatalogMessage,
  type ConsumerAlias,
  type LocalizationCatalog,
  type TranslationValue,
} from '@vouchington/localization'

type CatalogTables = Pick<LocalizationCatalog, 'aliases' | 'copies' | 'translations'>

export function emailMessagesFromCatalog(catalog: CatalogTables): CatalogMessage[] {
  const copies = new Map(catalog.copies.map((copy) => [copy.id, copy]))
  const translations = translationValues(catalog.translations)
  return catalog.aliases
    .filter((alias) => alias.consumer === 'email')
    .toSorted((left, right) => left.alias.localeCompare(right.alias, 'en'))
    .map((alias) => messageFromAlias(alias, copies, translations))
}

export function loadEmailCatalogMessages(directory: string): CatalogMessage[] {
  if (!existsSync(directory)) throw new Error(`Email catalog directory is missing at ${directory}`)
  const copies = rows(join(directory, 'copies.json'), catalogCopyFromRecord)
  const aliases = rows(join(directory, 'aliases.json'), consumerAliasFromRecord)
  const translationsDirectory = join(directory, 'translations')
  if (!existsSync(translationsDirectory)) {
    throw new Error(`Email catalog translations directory is missing at ${translationsDirectory}`)
  }
  const translations = Object.fromEntries(
    readdirSync(translationsDirectory)
      .filter((name) => name.endsWith('.json'))
      .toSorted((left, right) => left.localeCompare(right, 'en'))
      .map((name) => [
        name.slice(0, -'.json'.length),
        rows(join(translationsDirectory, name), translationRowFromRecord),
      ]),
  )
  return emailMessagesFromCatalog({ copies, aliases, translations })
}

function rows<Row>(path: string, parse: (value: unknown) => Row): Row[] {
  if (!existsSync(path)) throw new Error(`Email catalog JSON is missing at ${path}`)
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (!Array.isArray(parsed)) throw new TypeError(`Email catalog JSON must be an array at ${path}`)
  return parsed.map(parse)
}

function translationValues(
  translations: CatalogTables['translations'],
): Map<string, Record<string, TranslationValue>> {
  const values = new Map<string, Record<string, TranslationValue>>()
  for (const [locale, rows] of Object.entries(translations)) {
    for (const row of rows) {
      const existing = values.get(row.id) ?? {}
      existing[locale] = row.value
      values.set(row.id, existing)
    }
  }
  return values
}

function messageFromAlias(
  alias: ConsumerAlias,
  copies: ReadonlyMap<string, CatalogCopy>,
  translations: ReadonlyMap<string, Record<string, TranslationValue>>,
): CatalogMessage {
  const copy = copies.get(alias.copyId)
  if (copy === undefined)
    throw new TypeError(`Email alias "${alias.alias}" references missing copy`)
  const values = translations.get(copy.id)
  if (values === undefined) throw new TypeError(`Email copy "${copy.id}" has no translations`)
  return {
    id: alias.alias,
    consumers: ['email'],
    descriptor: copy.descriptor,
    translations: values,
  }
}
