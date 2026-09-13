import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  CatalogMergeConflict,
  canonicalJson,
  serializeCatalogTable,
} from '@vouchington/localization'

export function isTablePath(path: string): boolean {
  return /(?:copies|aliases|routes)\.json$/.test(path) || /translations\/[^/]+\.json$/.test(path)
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
  if (next.length === rows.length) throw new TypeError(`Catalog table does not contain "${id}"`)
  writeFileSync(path, serializeCatalogTable(next))
  return undefined
}
export function mergeTableFiles(ancestor: string, ours: string, theirs: string): void {
  const base = new Map(readTable(ancestor).map((row) => [tableKey(row), row]))
  const left = new Map(readTable(ours).map((row) => [tableKey(row), row]))
  const right = new Map(readTable(theirs).map((row) => [tableKey(row), row]))
  const merged: Record<string, unknown>[] = []
  const conflicts: string[] = []
  for (const key of [...new Set([...base.keys(), ...left.keys(), ...right.keys()])].sort()) {
    const value = mergeValue(base.get(key), left.get(key), right.get(key))
    if (value === undefined && (left.has(key) || right.has(key))) conflicts.push(key)
    else if (value !== undefined) merged.push(value)
  }
  if (conflicts.length > 0) {
    const text = conflicts.map((key) => conflictText(left.get(key), right.get(key))).join('\n')
    writeFileSync(ours, `${text}\n`)
    throw new CatalogMergeConflict(conflicts, text)
  }
  writeFileSync(ours, serializeCatalogTable(merged))
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
): Record<string, unknown> | undefined {
  if (same(ours, theirs)) return ours as Record<string, unknown> | undefined
  if (same(ours, base)) return theirs as Record<string, unknown> | undefined
  if (same(theirs, base)) return ours as Record<string, unknown> | undefined
  return undefined
}
function conflictText(ours: unknown, theirs: unknown): string {
  return [
    '<<<<<<< ours',
    ours === undefined ? '' : canonicalJson(ours),
    '=======',
    theirs === undefined ? '' : canonicalJson(theirs),
    '>>>>>>> theirs',
  ]
    .filter(Boolean)
    .join('\n')
}
function same(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right)
}
function tableKey(row: Record<string, unknown>): string {
  return ['consumer', 'selectorId', 'alias', 'id']
    .map((key) => (typeof row[key] === 'string' ? row[key] : ''))
    .join('\t')
}
