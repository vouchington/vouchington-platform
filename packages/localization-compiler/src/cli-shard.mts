import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import {
  CatalogMergeConflict,
  mergeCatalogShards,
  parseCatalogShardText,
  removeCatalogLine,
  serializeCatalogShard,
  upsertCatalogLine,
  serializeCatalogTable,
  canonicalJson,
} from '@vouchington/localization'
import { parseCatalogFile } from './validate.mts'
export function runShardCli(command: string, args: readonly string[]): string | undefined {
  if (command === 'upsert') {
    const path = requiredPath(args, '--file')
    if (isTablePath(path))
      return upsertTable(path, optional(args, '--row') ?? required(args, '--message'))
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, upsertCatalogLine(readShard(path), required(args, '--message')))
    return undefined
  }
  if (command === 'remove') {
    const path = requiredPath(args, '--file')
    if (isTablePath(path))
      return removeTable(path, required(args, '--id'), optional(args, '--consumer'))
    writeFileSync(path, removeCatalogLine(readFileSync(path, 'utf8'), required(args, '--id')))
    return undefined
  }
  if (command === 'git-merge') {
    const [ancestor, ours, theirs] = args
    if (ancestor === undefined || ours === undefined || theirs === undefined) {
      throw new TypeError(shardUsage())
    }
    if (isTablePath(ours)) {
      mergeTableFiles(ancestor, ours, theirs)
      return undefined
    }
    try {
      writeFileSync(
        ours,
        mergeCatalogShards(
          readFileSync(ancestor, 'utf8'),
          readFileSync(ours, 'utf8'),
          readFileSync(theirs, 'utf8'),
        ),
      )
    } catch (error) {
      if (error instanceof CatalogMergeConflict) writeFileSync(ours, error.text)
      throw error
    }
    return undefined
  }
  if (command === 'format') return formatCatalogDirectory(required(args, '--source'))
  throw new TypeError(shardUsage())
}
function mergeTableFiles(ancestor: string, ours: string, theirs: string): void {
  const base = new Map(readTable(ancestor).map((row) => [tableKey(row), row]))
  const left = new Map(readTable(ours).map((row) => [tableKey(row), row]))
  const right = new Map(readTable(theirs).map((row) => [tableKey(row), row]))
  const merged: Record<string, unknown>[] = []
  const conflicts: string[] = []
  for (const key of [...new Set([...base.keys(), ...left.keys(), ...right.keys()])].sort()) {
    const before = base.get(key)
    const oursRow = left.get(key)
    const theirsRow = right.get(key)
    const value = same(oursRow, theirsRow)
      ? oursRow
      : same(oursRow, before)
        ? theirsRow
        : same(theirsRow, before)
          ? oursRow
          : undefined
    if (value === undefined && (oursRow !== undefined || theirsRow !== undefined))
      conflicts.push(key)
    else if (value !== undefined) merged.push(value)
  }
  if (conflicts.length > 0) {
    const text = conflicts
      .map((key) =>
        [
          '<<<<<<< ours',
          left.has(key) ? canonicalJson(left.get(key)) : '',
          '=======',
          right.has(key) ? canonicalJson(right.get(key)) : '',
          '>>>>>>> theirs',
        ]
          .filter(Boolean)
          .join('\n'),
      )
      .join('\n')
    writeFileSync(ours, `${text}\n`)
    throw new CatalogMergeConflict(conflicts, text)
  }
  writeFileSync(ours, serializeCatalogTable(merged))
}
function same(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right)
}
function isTablePath(path: string): boolean {
  return /(?:copies|aliases|routes)\.json$/.test(path) || /translations\/[^/]+\.json$/.test(path)
}
function upsertTable(path: string, rowJson: string): undefined {
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
function removeTable(path: string, id: string, consumer: string | undefined): undefined {
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
function readTable(path: string): Record<string, unknown>[] {
  if (!existsSync(path)) return []
  const value = JSON.parse(readFileSync(path, 'utf8')) as unknown
  if (!Array.isArray(value)) throw new TypeError(`${path} must be a JSON array`)
  return value as Record<string, unknown>[]
}
function tableKey(row: Record<string, unknown>): string {
  return ['consumer', 'selectorId', 'alias', 'id'].map((key) => typeof row[key] === 'string' ? row[key] : '').join('\t')
}
export function shardUsage(): string {
  return [
    'Usage: vouchington-localization upsert --file <file> --message <json>',
    'Usage: vouchington-localization remove --file <file> --id <id>',
    'Usage: vouchington-localization git-merge <ancestor> <ours> <theirs>',
    'Usage: vouchington-localization format --source <dir>',
  ].join('\n')
}
function formatCatalogDirectory(directory: string): string {
  const names = readdirSync(directory).filter(
    (name) => name.endsWith('.json') && name !== 'tags.json',
  )
  for (const name of names) {
    const path = join(directory, name)
    try {
      if (isTablePath(path)) {
        writeFileSync(path, serializeCatalogTable(readTable(path)))
        continue
      }
      writeFileSync(
        path,
        serializeCatalogShard(messagesFromUnknownText(readFileSync(path, 'utf8'))),
      )
    } catch (error) {
      throw new TypeError(`${path}: ${(error as Error).message}`)
    }
  }
  const translations = join(directory, 'translations')
  if (existsSync(translations))
    for (const name of readdirSync(translations).filter((name) => name.endsWith('.json'))) {
      const path = join(translations, name)
      writeFileSync(path, serializeCatalogTable(readTable(path)))
    }
  return `${names.length} files`
}
function required(args: readonly string[], flag: string): string {
  const index = args.indexOf(flag)
  const value = index === -1 ? undefined : args[index + 1]
  if (value === undefined || value.startsWith('--')) throw new TypeError(shardUsage())
  return value
}
function optional(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  const value = index === -1 ? undefined : args[index + 1]
  return value === undefined || value.startsWith('--') ? undefined : value
}
function requiredPath(args: readonly string[], flag: string): string {
  return resolve(required(args, flag))
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
function readShard(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '[]\n'
}
