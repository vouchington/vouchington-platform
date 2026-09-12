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
  const next: string[] = []
  let placed = false
  for (const current of catalogShardLines(shardText)) {
    const currentId = catalogLineId(current)
    if (currentId === id) {
      next.push(line)
      placed = true
      continue
    }
    if (!placed && compareCodePoints(currentId, id) > 0) {
      next.push(line)
      placed = true
    }
    next.push(current)
  }
  if (!placed) next.push(line)
  return serializeCatalogShardFromLines(next)
}

export function removeCatalogLine(shardText: string, id: string): string {
  const lines = catalogShardLines(shardText)
  const next = lines.filter((line) => catalogLineId(line) !== id)
  if (next.length === lines.length) throw new TypeError(`Catalog does not contain "${id}"`)
  return serializeCatalogShardFromLines(next)
}
