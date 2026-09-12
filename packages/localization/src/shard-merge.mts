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

type ConflictSides = { ours: string | undefined; theirs: string | undefined }
type MergeEntry = string | ConflictSides

export class CatalogMergeConflict extends Error {
  readonly ids: readonly string[]
  readonly text: string

  constructor(ids: readonly string[], text: string) {
    super(`Catalog merge conflict for ${ids.map((id) => `"${id}"`).join(', ')}`)
    this.name = 'CatalogMergeConflict'
    this.ids = ids
    this.text = text
  }
}

export function mergeCatalogShards(ancestor: string, ours: string, theirs: string): string {
  const base = lineMap(ancestor)
  const left = lineMap(ours)
  const right = lineMap(theirs)
  const ids = [...new Set([...base.keys(), ...left.keys(), ...right.keys()])].toSorted(
    compareCodePoints,
  )
  const lines: string[] = []
  const entries: MergeEntry[] = []
  const conflicts: string[] = []
  for (const id of ids) {
    const oursLine = left.get(id)
    const theirsLine = right.get(id)
    const kept = mergeLine(base.get(id), oursLine, theirsLine)
    if (kept === false) {
      conflicts.push(id)
      entries.push({ ours: oursLine, theirs: theirsLine })
    } else if (kept !== undefined) {
      lines.push(kept)
      entries.push(kept)
    }
  }
  if (conflicts.length > 0) throw new CatalogMergeConflict(conflicts, serializeConflicted(entries))
  return serializeCatalogShardFromLines(lines)
}

function lineMap(text: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const line of catalogShardLines(text)) {
    const id = catalogLineId(line)
    if (map.has(id)) throw new TypeError(`Duplicate message id "${id}"`)
    map.set(id, line)
  }
  return map
}

function serializeConflicted(entries: readonly MergeEntry[]): string {
  const chunks = ['[']
  for (const [index, entry] of entries.entries()) {
    const suffix = index < entries.length - 1 ? ',' : ''
    if (typeof entry === 'string') {
      chunks.push(`${entry}${suffix}`)
      continue
    }
    chunks.push('<<<<<<< ours')
    if (entry.ours !== undefined) chunks.push(`${entry.ours}${suffix}`)
    chunks.push('=======')
    if (entry.theirs !== undefined) chunks.push(`${entry.theirs}${suffix}`)
    chunks.push('>>>>>>> theirs')
  }
  chunks.push(']')
  return `${chunks.join('\n')}\n`
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
