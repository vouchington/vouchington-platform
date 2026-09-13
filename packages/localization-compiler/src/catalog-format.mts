import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  parseCatalogShardText,
  serializeCatalogShard,
  serializeCatalogTable,
} from '@vouchington/localization'
import { loadCatalogDirectory } from './load.mts'
import { isTablePath, readTable } from './table-cli.mts'
import { parseCatalogFile } from './validate.mts'

export async function checkCatalogDirectory(directory: string): Promise<number> {
  const files = catalogFiles(directory)
  for (const path of files) {
    const actual = readFileSync(path, 'utf8')
    if (actual !== canonicalCatalogFile(path))
      throw new TypeError(`${path}: Catalog is not canonical. Run format to rewrite.`)
  }
  try {
    await loadCatalogDirectory(directory)
  } catch (error) {
    throw new TypeError(`${directory}: ${(error as Error).message}`)
  }
  return files.length
}

export function catalogFiles(directory: string): string[] {
  const files = readdirSync(directory)
    .filter((name) => name.endsWith('.json') && name !== 'tags.json')
    .map((name) => join(directory, name))
  const translations = join(directory, 'translations')
  if (existsSync(translations))
    files.push(
      ...readdirSync(translations)
        .filter((name) => name.endsWith('.json'))
        .map((name) => join(translations, name)),
    )
  return files.sort()
}

export function canonicalCatalogFile(path: string): string {
  try {
    if (isTablePath(path)) return serializeCatalogTable(readTable(path))
    return serializeCatalogShard(messagesFromUnknownText(readFileSync(path, 'utf8')))
  } catch (error) {
    throw new TypeError(`${path}: ${(error as Error).message}`)
  }
}

function messagesFromUnknownText(text: string) {
  try {
    return parseCatalogShardText(text)
  } catch (shardError) {
    try {
      return parseCatalogFile(JSON.parse(text) as unknown)
    } catch {
      throw shardError
    }
  }
}
