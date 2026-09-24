import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  CatalogMergeConflict,
  canonicalJson,
  serializeCatalogTable,
} from '@vouchington/localization'
import { CatalogRowNotFoundError } from './catalog-row-not-found.mts'
import { parseTableConflicts, serializeTableConflicts, tableKey } from './table-conflict.mts'

const CONFLICT = Symbol('conflict')

export function isTablePath(path: string): boolean {
  const normalized = path.replaceAll('\\', '/')
  return (
    /(?:copies|aliases|routes)\.json$/.test(normalized) ||
    /translations\/[^/]+\.json$/.test(normalized)
  )
}
export function upsertTable(path: string, rowJson: string): undefined {
  mkdirSync(dirname(path), { recursive: true })
  const row = JSON.parse(rowJson) as Record<string, unknown>
  const rows = readTable(path)
  const key = tableKey(row)
  writeFileSync(
    path,
    serializeCatalogTable([...rows.filter((current) => tableKey(current) !== key), row]),
  )
  return undefined
}
export function removeTable(path: string, id: string, consumer: string | undefined): undefined {
  const rows = readTable(path)
  const next = rows.filter(
    (row) =>
      !(
        row.id === id ||
        (row.alias === id && (consumer === undefined || row.consumer === consumer))
      ),
  )
  if (next.length === rows.length)
    throw new CatalogRowNotFoundError(id, consumer, `Catalog table does not contain "${id}"`)
  writeFileSync(path, serializeCatalogTable(next))
  return undefined
}
export function mergeTableFiles(ancestor: string, ours: string, theirs: string): void {
  const base = new Map(readTable(ancestor).map((row) => [tableKey(row), row]))
  const left = new Map(readTable(ours).map((row) => [tableKey(row), row]))
  const right = new Map(readTable(theirs).map((row) => [tableKey(row), row]))
  const merged: Record<string, unknown>[] = []
  const conflicts: {
    key: string
    ours: Record<string, unknown> | undefined
    theirs: Record<string, unknown> | undefined
  }[] = []
  for (const key of [...new Set([...base.keys(), ...left.keys(), ...right.keys()])].sort()) {
    const value = mergeValue(base.get(key), left.get(key), right.get(key))
    if (value === CONFLICT) conflicts.push({ key, ours: left.get(key), theirs: right.get(key) })
    else if (value !== undefined) merged.push(value)
  }
  if (conflicts.length > 0) {
    const text = serializeTableConflicts(merged, conflicts)
    writeFileSync(ours, text)
    throw new CatalogMergeConflict(
      conflicts.map((conflict) => conflict.key),
      text,
    )
  }
  writeFileSync(ours, serializeCatalogTable(merged))
}
export function resolveTableConflict(
  path: string,
  id: string,
  consumer: string | undefined,
  selectorId: string | undefined,
  take: 'ours' | 'theirs',
): void {
  const { rows, conflicts } = parseTableConflicts(readFileSync(path, 'utf8'))
  const matching = conflicts.filter((conflict) =>
    [conflict.ours, conflict.theirs].some(
      (row) =>
        row !== undefined &&
        (row.id === id || row.alias === id) &&
        (consumer === undefined || row.consumer === consumer) &&
        (selectorId === undefined || row.selectorId === selectorId),
    ),
  )
  if (matching.length !== 1) throw new TypeError(`Catalog conflict does not uniquely match "${id}"`)
  const conflict = matching[0]!
  const selected = conflict[take]
  const remaining = conflicts.filter((current) => current !== conflict)
  if (selected !== undefined) rows.push(selected)
  writeFileSync(
    path,
    remaining.length === 0 ? serializeCatalogTable(rows) : serializeTableConflicts(rows, remaining),
  )
}
export function readTable(path: string): Record<string, unknown>[] {
  if (!existsSync(path)) return []
  const value = JSON.parse(readFileSync(path, 'utf8')) as unknown
  if (!Array.isArray(value)) throw new TypeError(`${path} must be a JSON array`)
  return value as Record<string, unknown>[]
}
function mergeValue(
  base: unknown,
  ours: unknown,
  theirs: unknown,
): Record<string, unknown> | undefined | typeof CONFLICT {
  if (same(ours, theirs)) return ours as Record<string, unknown> | undefined
  if (same(ours, base)) return theirs as Record<string, unknown> | undefined
  if (same(theirs, base)) return ours as Record<string, unknown> | undefined
  return CONFLICT
}
function same(left: unknown, right: unknown): boolean {
  if (left === undefined || right === undefined) return left === right
  return canonicalJson(left) === canonicalJson(right)
}
