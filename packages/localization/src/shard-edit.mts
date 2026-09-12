import {
  catalogLineId,
  catalogMessageFromRecord,
  serializeCatalogLine,
  serializeCatalogShardFromLines,
} from './catalog.mts'
import { compareCodePoints } from './compare.mts'
import { catalogShardLines } from './shard-text.mts'

export function upsertCatalogLine(shardText: string, messageJson: string): string {
  const line = serializeCatalogLine(catalogMessageFromRecord(JSON.parse(messageJson) as unknown))
  const id = catalogLineId(line)
  const next = catalogShardLines(shardText).filter((current) => catalogLineId(current) !== id)
  next.push(line)
  return serializeCatalogShardFromLines(sortedLines(next))
}

export function removeCatalogLine(shardText: string, id: string): string {
  const lines = catalogShardLines(shardText)
  const next = lines.filter((line) => catalogLineId(line) !== id)
  if (next.length === lines.length) throw new TypeError(`Catalog does not contain "${id}"`)
  return serializeCatalogShardFromLines(sortedLines(next))
}

function sortedLines(lines: readonly string[]): string[] {
  return [...lines].toSorted((left, right) =>
    compareCodePoints(catalogLineId(left), catalogLineId(right)),
  )
}
