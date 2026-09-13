import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import {
  CatalogMergeConflict,
  mergeCatalogShards,
  parseCatalogShardText,
  removeCatalogLine,
  serializeCatalogTable,
  serializeCatalogShard,
  upsertCatalogLine,
} from '@vouchington/localization'
import { isTablePath, mergeTableFiles, readTable, removeTable, upsertTable } from './table-cli.mts'
import { parseCatalogFile } from './validate.mts'

export function runShardCli(command: string, args: readonly string[]): string | undefined {
  if (command === 'upsert') return upsert(args)
  if (command === 'remove') return remove(args)
  if (command === 'git-merge') return merge(args)
  if (command === 'format') return formatCatalogDirectory(required(args, '--source'))
  throw new TypeError(shardUsage())
}
function upsert(args: readonly string[]): undefined {
  const path = requiredPath(args, '--file')
  if (isTablePath(path))
    return upsertTable(path, optional(args, '--row') ?? required(args, '--message'))
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, upsertCatalogLine(readShard(path), required(args, '--message')))
}
function remove(args: readonly string[]): undefined {
  const path = requiredPath(args, '--file')
  if (isTablePath(path))
    return removeTable(path, required(args, '--id'), optional(args, '--consumer'))
  writeFileSync(path, removeCatalogLine(readFileSync(path, 'utf8'), required(args, '--id')))
}
function merge(args: readonly string[]): undefined {
  const [ancestor, ours, theirs] = args
  if (ancestor === undefined || ours === undefined || theirs === undefined)
    throw new TypeError(shardUsage())
  if (isTablePath(optional(args, '--path') ?? ours)) {
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
}
export function shardUsage(): string {
  return [
    'Usage: vouchington-localization upsert --file <file> --row <json>',
    'Usage: vouchington-localization remove --file <file> --id <id> [--consumer <consumer>]',
    'Usage: vouchington-localization git-merge <ancestor> <ours> <theirs> [--path <path>]',
    'Usage: vouchington-localization format --source <dir>',
  ].join('\n')
}
function formatCatalogDirectory(directory: string): string {
  const names = readdirSync(directory).filter(
    (name) => name.endsWith('.json') && name !== 'tags.json',
  )
  for (const name of names) formatFile(join(directory, name))
  const translations = join(directory, 'translations')
  if (existsSync(translations))
    for (const name of readdirSync(translations).filter((name) => name.endsWith('.json')))
      formatFile(join(translations, name))
  return `${names.length} files`
}
function formatFile(path: string): void {
  try {
    if (isTablePath(path)) return writeFileSync(path, serializeCatalogTable(readTable(path)))
    writeFileSync(path, serializeCatalogShard(messagesFromUnknownText(readFileSync(path, 'utf8'))))
  } catch (error) {
    throw new TypeError(`${path}: ${(error as Error).message}`)
  }
}
function required(args: readonly string[], flag: string): string {
  const value = optional(args, flag)
  if (value === undefined) throw new TypeError(shardUsage())
  return value
}
function optional(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  if (index === -1) return undefined
  const value = args[index + 1]
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
