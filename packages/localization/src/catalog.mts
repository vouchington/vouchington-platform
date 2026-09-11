import { uniqueConsumers } from './consumers.mts'
import { parseDescriptor } from './descriptors.mts'
import { canonicalJson } from './serialize.mts'
import { isMessageId } from './selectors.mts'
import type { CatalogMessage } from './types.mts'

export function serializeCatalogMessages(messages: readonly CatalogMessage[]): string {
  return canonicalJson(
    [...messages]
      .toSorted((left, right) => (left.id < right.id ? -1 : 1))
      .map((message) => ({
        consumers: uniqueConsumers(message.consumers),
        descriptor: message.descriptor,
        id: message.id,
        translations: message.translations,
      })),
  )
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
