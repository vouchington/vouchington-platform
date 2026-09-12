import { uniqueConsumers } from './consumers.mts'
import { compareCodePoints } from './compare.mts'
import { parseDescriptor } from './descriptors.mts'
import { canonicalJson } from './serialize.mts'
import { isMessageId } from './selectors.mts'
import type { CatalogMessage } from './types.mts'

const ID_PREFIX = '{"id":"'

export function serializeCatalogMessages(messages: readonly CatalogMessage[]): string {
  return canonicalJson(
    [...messages]
      .toSorted((left, right) => compareCodePoints(left.id, right.id))
      .map((message) => ({
        consumers: uniqueConsumers(message.consumers),
        descriptor: message.descriptor,
        id: message.id,
        translations: message.translations,
      })),
  )
}

export function serializeCatalogLine(message: CatalogMessage): string {
  const normalized = catalogMessageFromRecord(message)
  return `{"id":${canonicalJson(normalized.id)},"consumers":${canonicalJson(normalized.consumers)},"descriptor":${canonicalJson(normalized.descriptor)},"translations":${canonicalJson(normalized.translations)}}`
}

export function serializeCatalogShard(messages: readonly CatalogMessage[]): string {
  return serializeCatalogShardFromLines(
    [...messages]
      .toSorted((left, right) => compareCodePoints(left.id, right.id))
      .map(serializeCatalogLine),
  )
}

export function serializeCatalogShardFromLines(lines: readonly string[]): string {
  if (lines.length === 0) return '[]\n'
  return `[\n${lines.map((line, index) => (index < lines.length - 1 ? `${line},` : line)).join('\n')}\n]\n`
}

export function catalogLineId(line: string): string {
  const body = line.endsWith(',') ? line.slice(0, -1) : line
  if (!body.startsWith(ID_PREFIX)) {
    throw new TypeError('Catalog line must start with {"id":')
  }
  const end = body.indexOf('"', ID_PREFIX.length)
  if (end === -1) throw new TypeError('Catalog line is missing a message id')
  return body.slice(ID_PREFIX.length, end)
}

export function catalogMessageFromRecord(value: unknown): CatalogMessage {
  if (!isPlainObject(value) || typeof value.id !== 'string' || !isMessageId(value.id)) {
    throw new TypeError('Catalog message is missing a valid id')
  }
  if (!Array.isArray(value.consumers) || value.consumers.length === 0) {
    throw new TypeError(`Catalog message "${value.id}" must declare consumers`)
  }
  if (!isPlainObject(value.translations) || Object.keys(value.translations).length === 0) {
    throw new TypeError(`Catalog message "${value.id}" must declare translations`)
  }
  return {
    id: value.id,
    descriptor: parseDescriptor(value.descriptor ?? null),
    consumers: uniqueConsumers(value.consumers.map(String)),
    translations: value.translations as CatalogMessage['translations'],
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
