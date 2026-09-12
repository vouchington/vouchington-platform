import {
  catalogLineId,
  catalogMessageFromRecord,
  serializeCatalogLine,
  serializeCatalogShardFromLines,
} from './catalog.mts'
import { compareCodePoints } from './compare.mts'
import { uniqueConsumers } from './consumers.mts'
import { canonicalJson } from './serialize.mts'
import { catalogShardLines } from './shard-text.mts'
import { LOCALIZATION_CONSUMERS, type CatalogMessage, type LocalizationConsumer } from './types.mts'

const CONFLICT = Symbol('conflict')

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
  if (ours === undefined || theirs === undefined) return false
  return mergeEditedLines(ancestor, ours, theirs)
}

function mergeEditedLines(
  ancestor: string | undefined,
  ours: string,
  theirs: string,
): string | false {
  const base = ancestor === undefined ? emptyDraft(ours) : messageFromLine(ancestor)
  const left = messageFromLine(ours)
  const right = messageFromLine(theirs)
  const consumers = mergeConsumers(base.consumers, left.consumers, right.consumers)
  const descriptor = mergeValue(base.descriptor, left.descriptor, right.descriptor)
  const translations = mergeTranslations(base.translations, left.translations, right.translations)
  if (descriptor === CONFLICT || translations === CONFLICT) return false
  try {
    return serializeCatalogLine(
      catalogMessageFromRecord({ id: left.id, consumers, descriptor, translations }),
    )
  } catch {
    return false
  }
}

function emptyDraft(line: string): CatalogMessage {
  return { id: catalogLineId(line), descriptor: null, consumers: [], translations: {} }
}

function messageFromLine(line: string): CatalogMessage {
  return catalogMessageFromRecord(JSON.parse(line) as unknown)
}

function mergeConsumers(
  ancestor: readonly LocalizationConsumer[],
  ours: readonly LocalizationConsumer[],
  theirs: readonly LocalizationConsumer[],
): readonly LocalizationConsumer[] {
  const kept: LocalizationConsumer[] = []
  for (const consumer of LOCALIZATION_CONSUMERS) {
    if (
      mergeValue(
        ancestor.includes(consumer),
        ours.includes(consumer),
        theirs.includes(consumer),
      ) === true
    ) {
      kept.push(consumer)
    }
  }
  return uniqueConsumers(kept)
}

function mergeTranslations(
  ancestor: CatalogMessage['translations'],
  ours: CatalogMessage['translations'],
  theirs: CatalogMessage['translations'],
): CatalogMessage['translations'] | typeof CONFLICT {
  const locales = new Set([...Object.keys(ancestor), ...Object.keys(ours), ...Object.keys(theirs)])
  const translations: Record<string, CatalogMessage['translations'][string]> = {}
  for (const locale of [...locales].toSorted(compareCodePoints)) {
    const value = mergeValue(ancestor[locale], ours[locale], theirs[locale])
    if (value === CONFLICT) return CONFLICT
    if (value !== undefined) translations[locale] = value
  }
  return translations
}

function mergeValue<T>(ancestor: T, ours: T, theirs: T): T | typeof CONFLICT {
  if (same(ours, theirs)) return ours
  if (same(ours, ancestor)) return theirs
  if (same(theirs, ancestor)) return ours
  return CONFLICT
}

function same(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (left === undefined || right === undefined || left === null || right === null) return false
  if (typeof left !== 'object' || typeof right !== 'object') return false
  return canonicalJson(left) === canonicalJson(right)
}
