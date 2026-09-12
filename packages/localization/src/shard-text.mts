import { catalogLineId, catalogMessageFromRecord, serializeCatalogLine } from './catalog.mts'
import { compareCodePoints } from './compare.mts'
import type { CatalogMessage } from './types.mts'

export function catalogShardLines(text: string): string[] {
  if (text === '[]\n') return []
  if (!text.startsWith('[\n') || !text.endsWith('\n]\n')) {
    throw new TypeError('Catalog shard must be a JSON array with one message per line')
  }
  const raw = text.slice(2, -3).split('\n')
  return raw.map((line, index) => {
    const needsComma = index < raw.length - 1
    if (line.endsWith(',') !== needsComma) {
      throw new TypeError('Catalog shard commas must appear on every line except the last')
    }
    const body = needsComma ? line.slice(0, -1) : line
    if (body.length === 0) {
      throw new TypeError('Catalog shard messages must be exactly one line each')
    }
    catalogLineId(body)
    return body
  })
}

export function parseCatalogShardText(text: string): CatalogMessage[] {
  const lines = catalogShardLines(text)
  const messages = lines.map((line) => {
    const message = catalogMessageFromRecord(JSON.parse(line) as unknown)
    if (serializeCatalogLine(message) !== line) {
      throw new TypeError(`Catalog line for "${message.id}" is not canonical`)
    }
    return message
  })
  for (let index = 1; index < messages.length; index++) {
    const previous = messages[index - 1]!.id
    const current = messages[index]!.id
    if (previous === current) throw new TypeError(`Duplicate message id "${current}"`)
    if (compareCodePoints(previous, current) > 0) {
      throw new TypeError('Catalog shard ids must be sorted')
    }
  }
  return messages
}
