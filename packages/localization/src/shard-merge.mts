import { catalogLineId, serializeCatalogShardFromLines } from './catalog.mts'
import { compareCodePoints } from './compare.mts'
import { catalogShardLines } from './shard-text.mts'

export class CatalogMergeConflict extends Error {
  readonly ids: readonly string[]

  constructor(ids: readonly string[]) {
    super(`Catalog merge conflict for ${ids.map((id) => `"${id}"`).join(', ')}`)
    this.name = 'CatalogMergeConflict'
    this.ids = ids
  }
}

export function mergeCatalogShards(ancestor: string, ours: string, theirs: string): string {
  const base = lineMap(ancestor)
  const left = lineMap(ours)
  const right = lineMap(theirs)
  const ids = [...new Set([...base.keys(), ...left.keys(), ...right.keys()])].toSorted(
    compareCodePoints,
  )
  const merged: string[] = []
  const conflicts: string[] = []
  for (const id of ids) {
    const kept = mergeLine(base.get(id), left.get(id), right.get(id))
    if (kept === false) conflicts.push(id)
    else if (kept !== undefined) merged.push(kept)
  }
  if (conflicts.length > 0) throw new CatalogMergeConflict(conflicts)
  return serializeCatalogShardFromLines(merged)
}

function lineMap(text: string): Map<string, string> {
  return new Map(catalogShardLines(text).map((line) => [catalogLineId(line), line]))
}

function mergeLine(
  ancestor: string | undefined,
  ours: string | undefined,
  theirs: string | undefined,
): string | undefined | false {
  if (ours === theirs) return ours
  if (ours === ancestor) return theirs
  if (theirs === ancestor) return ours
  return false
}
