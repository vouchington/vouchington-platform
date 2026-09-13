import { parseCsvRows, stringifyCsvRows } from '@vouchington/csv'
import { canonicalJson, type LocalizationCatalog } from '@vouchington/localization'
import { sortedCatalog } from './catalog.mts'
import { catalogRevision } from './revision.mts'

const columns = [
  'id',
  'locale',
  'descriptor_json',
  'aliases_json',
  'value_json',
  'catalog_revision',
] as const

export function exportCatalogCsv(catalog: LocalizationCatalog): string {
  const source = sortedCatalog(catalog)
  const revision = catalogRevision(source)
  return stringifyCsvRows(
    Object.entries(source.translations).flatMap(([locale, rows]) =>
      rows.map((row) => ({
        id: row.id,
        locale,
        descriptor_json: canonicalJson(
          source.copies.find((copy) => copy.id === row.id)!.descriptor,
        ),
        aliases_json: canonicalJson(
          source.aliases
            .filter((alias) => alias.copyId === row.id)
            .map(({ consumer, alias }) => ({ consumer, alias })),
        ),
        value_json: canonicalJson(row.value),
        catalog_revision: revision,
      })),
    ),
    columns,
  )
}

export function importCatalogCsv(csv: string, expectedRevision?: string): LocalizationCatalog {
  const [header, ...rows] = parseCsvRows(csv)
  if (header?.join(',') !== columns.join(','))
    throw new TypeError('CSV header must match the localization interchange contract')
  const copies = new Map<string, unknown>()
  const aliases = new Map<string, unknown>()
  const translations: Record<string, unknown[]> = {}
  let revision: string | undefined
  for (const row of rows) {
    const [id, locale, descriptor, aliasJson, value, current] = row as [
      string,
      string,
      string,
      string,
      string,
      string,
    ]
    if (revision !== undefined && revision !== current)
      throw new TypeError('CSV rows must share a single catalog_revision')
    revision = current
    copies.set(id, { id, descriptor: JSON.parse(descriptor) as unknown })
    for (const alias of JSON.parse(aliasJson) as Array<{ consumer: string; alias: string }>)
      aliases.set(`${alias.consumer}\t${alias.alias}`, { ...alias, copyId: id })
    ;(translations[locale] ??= []).push({ id, value: JSON.parse(value) as unknown })
  }
  const catalog = sortedCatalog({
    copies: [...copies.values()] as LocalizationCatalog['copies'],
    aliases: [...aliases.values()] as LocalizationCatalog['aliases'],
    translations: translations as LocalizationCatalog['translations'],
  })
  if (expectedRevision !== undefined && revision !== expectedRevision)
    throw new TypeError('CSV catalog_revision does not match the source contract hash')
  if (revision !== catalogRevision(catalog))
    throw new TypeError('CSV catalog_revision does not match reconstructed catalog')
  return catalog
}
