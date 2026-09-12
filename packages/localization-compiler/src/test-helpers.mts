import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serializeCatalogShard, type CatalogMessage } from '@vouchington/localization'

export function sampleMessages(): CatalogMessage[] {
  return [
    {
      id: 'nav.home',
      descriptor: null,
      consumers: ['web', 'swift'],
      translations: { 'en-US': 'Home', es: 'Inicio' },
    },
    {
      id: 'common.save',
      descriptor: null,
      consumers: ['web'],
      translations: { 'en-US': 'Save "{name}"' },
    },
    {
      id: 'settings.count',
      descriptor: { kind: 'plural', valueParameter: 'count' },
      consumers: ['web', 'dotnet'],
      translations: {
        'en-US': { one: '{count} item', other: '{count} items' },
        es: { one: '{count} artículo', other: '{count} artículos' },
      },
    },
    {
      id: 'settings.ago',
      descriptor: {
        kind: 'select-plural',
        valueParameter: 'value',
        selectParameter: 'unit',
        cases: ['day'],
      },
      consumers: ['email'],
      translations: {
        'en-US': { day: { one: '{value} day ago', other: '{value} days ago' } },
      },
    },
  ]
}

export function writeCatalog(files: Record<string, unknown>): string {
  const directory = mkdtempSync(join(tmpdir(), 'catalog-'))
  mkdirSync(directory, { recursive: true })
  for (const [name, value] of Object.entries(files)) {
    writeFileSync(
      join(directory, name),
      name === 'tags.json' || !Array.isArray(value)
        ? `${JSON.stringify(value, null, 2)}\n`
        : serializeCatalogShard(value as CatalogMessage[]),
    )
  }
  return directory
}
