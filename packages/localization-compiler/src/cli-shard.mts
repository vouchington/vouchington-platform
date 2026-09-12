import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import {
  CatalogMergeConflict,
  mergeCatalogShards,
  parseCatalogShardText,
  removeCatalogLine,
  serializeCatalogShard,
  upsertCatalogLine,
} from '@vouchington/localization'
import { parseCatalogFile } from './validate.mts'

export function runShardCli(command: string, args: readonly string[]): string | undefined {
  if (command === 'upsert') {
    const path = requiredPath(args, '--file')
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, upsertCatalogLine(readShard(path), required(args, '--message')))
    return undefined
  }
  if (command === 'remove') {
    const path = requiredPath(args, '--file')
    writeFileSync(path, removeCatalogLine(readFileSync(path, 'utf8'), required(args, '--id')))
    return undefined
  }
  if (command === 'git-merge') {
    const [ancestor, ours, theirs] = args
    if (ancestor === undefined || ours === undefined || theirs === undefined) {
      throw new TypeError(shardUsage())
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
      writeFileSync(
        path,
        serializeCatalogShard(messagesFromUnknownText(readFileSync(path, 'utf8'))),
      )
    } catch (error) {
      throw new TypeError(`${path}: ${(error as Error).message}`)
    }
  }
  return `${names.length} files`
}

function required(args: readonly string[], flag: string): string {
  const index = args.indexOf(flag)
  const value = index === -1 ? undefined : args[index + 1]
  if (value === undefined || value.startsWith('--')) throw new TypeError(shardUsage())
  return value
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
