import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  compareCodePoints,
  parseCatalogShardText,
  type CatalogMessage,
} from '@vouchington/localization'
import { validateCatalogMessages } from './validate.mts'

export type EditorialTags = Readonly<Record<string, readonly string[]>>

export async function loadCatalogDirectory(directory: string): Promise<{
  messages: CatalogMessage[]
  tags: EditorialTags
}> {
  const names = (await readdir(directory))
    .filter((name) => name.endsWith('.json'))
    .toSorted(compareCodePoints)
  if (names.length === 0) throw new TypeError(`No catalog JSON files in "${directory}"`)
  const messages: CatalogMessage[] = []
  let tags: EditorialTags = {}
  for (const name of names) {
    const text = await readFile(join(directory, name), 'utf8')
    if (name === 'tags.json') {
      tags = parseTags(JSON.parse(text) as unknown)
      continue
    }
    messages.push(...parseCatalogShardText(text))
  }
  if (messages.length === 0) throw new TypeError(`No catalog messages in "${directory}"`)
  validateCatalogMessages(messages)
  validateTagTargets(messages, tags)
  return { messages, tags }
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

function validateTagTargets(messages: readonly CatalogMessage[], tags: EditorialTags): void {
  const ids = new Set(messages.map((message) => message.id))
  for (const id of Object.keys(tags)) {
    if (!ids.has(id)) throw new TypeError(`Editorial tag target "${id}" is not in the catalog`)
  }
}
