import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  CatalogMergeConflict,
  mergeCatalogShards,
  removeCatalogLine,
  upsertCatalogLine,
} from '@vouchington/localization'
import {
  isTablePath,
  mergeTableFiles,
  removeTable,
  resolveTableConflict,
  upsertTable,
} from './table-cli.mts'
import { canonicalCatalogFile, catalogFiles } from './catalog-format.mts'

export function runShardCli(command: string, args: readonly string[]): string | undefined {
  if (command === 'upsert') return upsert(args)
  if (command === 'remove') return remove(args)
  if (command === 'git-merge') return merge(args)
  if (command === 'conflict-resolve') return resolveConflict(args)
  if (command === 'format') return formatCatalogDirectory(required(args, '--source'))
  throw new TypeError(shardUsage())
}
function resolveConflict(args: readonly string[]): undefined {
  const take = required(args, '--take')
  if (take !== 'ours' && take !== 'theirs') throw new TypeError(shardUsage())
  resolveTableConflict(
    requiredPath(args, '--file'),
    required(args, '--id'),
    optional(args, '--consumer'),
    optional(args, '--selector-id'),
    take,
  )
  return undefined
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
    'Usage: vouchington-localization conflict-resolve --file <file> --id <id> [--consumer <consumer>] [--selector-id <selectorId>] --take <ours|theirs>',
    'Usage: vouchington-localization format [--check] --source <dir>',
  ].join('\n')
}
function formatCatalogDirectory(directory: string): string {
  const files = catalogFiles(directory)
  for (const path of files) writeFileSync(path, canonicalCatalogFile(path))
  return `${files.length} files`
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
function readShard(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '[]\n'
}
