import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  catalogFromMessages,
  compareCodePoints,
  parseCatalogShardText,
  type CatalogMessage,
  type LocalizationCatalog,
} from '@vouchington/localization'
import { sortedCatalog } from './catalog.mts'
import { expandRouteSelectors } from './route-selectors.mts'

export type EditorialTags = Readonly<Record<string, readonly string[]>>

export async function loadCatalogDirectory(directory: string): Promise<{
  catalog: LocalizationCatalog
  /** @deprecated use catalog; retained for the 0.x compiler adapter. */
  messages: never[]
  tags: EditorialTags
}> {
  const names = (await readdir(directory)).toSorted(compareCodePoints)
  if (names.length === 0) throw new TypeError(`No catalog JSON files in "${directory}"`)
  if (!names.some((name) => name.endsWith('.json')))
    throw new TypeError(`No catalog JSON files in "${directory}"`)
  const copies = await optionalRows(directory, 'copies.json')
  const aliases = await optionalRows(directory, 'aliases.json')
  const routeRows: unknown[] = (await optionalRows(directory, 'routes.json')) ?? []
  const translations =
    copies !== undefined && aliases !== undefined ? await translationRows(directory) : {}
  let tags: EditorialTags = {}
  const legacy: CatalogMessage[] = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    if (name === 'copies.json' || name === 'aliases.json' || name === 'routes.json') continue
    const text = await readFile(join(directory, name), 'utf8')
    if (name === 'tags.json') {
      tags = parseTags(JSON.parse(text) as unknown)
      continue
    }
    if (copies === undefined || aliases === undefined) legacy.push(...parseCatalogShardText(text))
  }
  if (copies === undefined || aliases === undefined) {
    if (legacy.length === 0) throw new TypeError(`No catalog messages in "${directory}"`)
    return {
      catalog: sortedCatalog({ ...catalogFromMessages(legacy), tags }),
      messages: legacy as never[],
      tags,
    }
  }
  const routes = expandRouteSelectors(routeRows)
  const catalog = sortedCatalog({
    copies: copies as LocalizationCatalog['copies'],
    aliases: aliases as LocalizationCatalog['aliases'],
    translations: translations as LocalizationCatalog['translations'],
    routeMembership: routes.routeMembership,
    routeSelectors: routes.routeSelectors,
    tags,
  })
  return { catalog, messages: [], tags }
}

async function translationRows(directory: string): Promise<Record<string, unknown[]>> {
  const path = join(directory, 'translations')
  let names: string[]
  try {
    names = await readdir(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new TypeError('Catalog is missing translations/')
    throw error
  }
  const translations: Record<string, unknown[]> = {}
  for (const name of names.filter((name) => name.endsWith('.json')).toSorted(compareCodePoints)) {
    const value = JSON.parse(await readFile(join(path, name), 'utf8')) as unknown
    if (!Array.isArray(value)) throw new TypeError(`translations/${name} must be a JSON array`)
    translations[name.slice(0, -5)] = value
  }
  return translations
}

async function optionalRows(directory: string, name: string): Promise<unknown[] | undefined> {
  try {
    const value = JSON.parse(await readFile(join(directory, name), 'utf8')) as unknown
    if (!Array.isArray(value)) throw new TypeError(`${name} must be a JSON array`)
    return value
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function parseTags(value: unknown): EditorialTags {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('tags.json must be an object mapping message ids to tag arrays')
  }
  return Object.fromEntries(
    Object.entries(value).map(([id, tags]) => {
      if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== 'string' || tag.length === 0)) {
        throw new TypeError(`Invalid editorial tags for "${id}"`)
      }
      return [id, [...new Set(tags)].toSorted(compareCodePoints)]
    }),
  )
}
