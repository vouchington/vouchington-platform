import { parseCsvRows, stringifyCsvRows } from '@vouchington/csv'
import {
  catalogMessageFromRecord,
  canonicalJson,
  compareCodePoints,
  type CatalogMessage,
} from '@vouchington/localization'
import { catalogRevision } from './revision.mts'
import { validateCatalogMessages } from './validate.mts'

const COLUMNS = [
  'id',
  'locale',
  'consumers',
  'descriptor_json',
  'value_json',
  'catalog_revision',
] as const

export function exportLocalizationCsv(messages: readonly CatalogMessage[]): string {
  validateCatalogMessages(messages)
  const revision = catalogRevision(messages)
  const rows = messages.flatMap((message) =>
    Object.keys(message.translations)
      .toSorted(compareCodePoints)
      .map((locale) => ({
        id: message.id,
        locale,
        consumers: message.consumers.join('|'),
        descriptor_json: canonicalJson(message.descriptor),
        value_json: canonicalJson(message.translations[locale]),
        catalog_revision: revision,
      })),
  )
  return stringifyCsvRows(rows, COLUMNS)
}

export function importLocalizationCsv(
  csv: string,
  options: { expectedRevision?: string } = {},
): CatalogMessage[] {
  const [header, ...rows] = parseCsvRows(csv)
  if (header === undefined || header.join(',') !== COLUMNS.join(',')) {
    throw new TypeError('CSV header must match the localization interchange contract')
  }
  if (rows.length === 0) throw new TypeError('CSV has no data rows')
  const drafts = new Map<
    string,
    { consumers: string; descriptor_json: string; translations: Record<string, string> }
  >()
  const seen = new Set<string>()
  let revision: string | undefined
  for (const row of rows) {
    const record = csvRecord(row)
    if (revision !== undefined && record.catalog_revision !== revision) {
      throw new TypeError('CSV rows must share a single catalog_revision')
    }
    revision = record.catalog_revision
    const key = `${record.id}\t${record.locale}`
    if (seen.has(key))
      throw new TypeError(`Duplicate CSV row for "${record.id}" in ${record.locale}`)
    seen.add(key)
    const draft = drafts.get(record.id) ?? {
      consumers: record.consumers,
      descriptor_json: record.descriptor_json,
      translations: {},
    }
    draft.translations[record.locale] = record.value_json
    drafts.set(record.id, draft)
  }
  const messages = [...drafts].map(([id, draft]) =>
    catalogMessageFromRecord({
      id,
      consumers: draft.consumers.split('|'),
      descriptor: JSON.parse(draft.descriptor_json) as unknown,
      translations: Object.fromEntries(
        Object.entries(draft.translations).map(([locale, value]) => [
          locale,
          JSON.parse(value) as unknown,
        ]),
      ),
    }),
  )
  if (options.expectedRevision !== undefined && revision !== options.expectedRevision) {
    throw new TypeError('CSV catalog_revision does not match the source contract hash')
  }
  validateCatalogMessages(messages)
  if (revision !== catalogRevision(messages)) {
    throw new TypeError('CSV catalog_revision does not match reconstructed catalog')
  }
  return messages
}

export function csvRecord(row: readonly string[]): Record<(typeof COLUMNS)[number], string> {
  const record = {} as Record<(typeof COLUMNS)[number], string>
  for (const [index, column] of COLUMNS.entries()) {
    const value = row[index]
    if (value === undefined) throw new TypeError(`CSV row is missing ${column}`)
    record[column] = value
  }
  return record
}
