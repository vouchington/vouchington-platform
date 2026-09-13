import { uniqueConsumers } from './consumers.mts'
import { parseDescriptor } from './descriptors.mts'
import { compareCodePoints } from './compare.mts'
import { canonicalJson } from './serialize.mts'
import { isMessageId } from './selectors.mts'
import type {
  CatalogCopy,
  CatalogMessage,
  ConsumerAlias,
  LocalizationCatalog,
  RouteSelectorMembership,
  TranslationRow,
} from './types.mts'

export function catalogCopyFromRecord(value: unknown): CatalogCopy {
  if (!object(value) || typeof value.id !== 'string' || !isMessageId(value.id)) {
    throw new TypeError('Copy is missing a valid id')
  }
  return { id: value.id, descriptor: parseDescriptor(value.descriptor ?? null) }
}

export function consumerAliasFromRecord(value: unknown): ConsumerAlias {
  if (!object(value) || typeof value.alias !== 'string' || !isMessageId(value.alias)) {
    throw new TypeError('Alias is missing a valid alias')
  }
  if (typeof value.copyId !== 'string' || !isMessageId(value.copyId)) {
    throw new TypeError(`Alias "${value.alias}" is missing a valid copyId`)
  }
  return {
    consumer: uniqueConsumers([String(value.consumer)])[0]!,
    alias: value.alias,
    copyId: value.copyId,
  }
}

export function translationRowFromRecord(value: unknown): TranslationRow {
  if (
    !object(value) ||
    typeof value.id !== 'string' ||
    !isMessageId(value.id) ||
    !('value' in value)
  ) {
    throw new TypeError('Translation is missing a valid id or value')
  }
  return { id: value.id, value: value.value as TranslationRow['value'] }
}

export function routeSelectorMembershipFromRecord(value: unknown): RouteSelectorMembership {
  if (!object(value) || typeof value.selectorId !== 'string' || !isMessageId(value.selectorId)) {
    throw new TypeError('Route membership is missing a valid selectorId')
  }
  if (typeof value.alias !== 'string' || !isMessageId(value.alias)) {
    throw new TypeError('Route membership is missing a valid alias')
  }
  return {
    consumer: uniqueConsumers([String(value.consumer)])[0]!,
    selectorId: value.selectorId,
    alias: value.alias,
  }
}

export function catalogFromMessages(messages: readonly CatalogMessage[]): LocalizationCatalog {
  const copies = messages.map(({ id, descriptor }) => ({ id, descriptor }))
  const aliases = messages.flatMap(({ id, consumers }) =>
    consumers.map((consumer) => ({ consumer, alias: id, copyId: id })),
  )
  const translations: Record<string, TranslationRow[]> = {}
  for (const message of messages)
    for (const [locale, value] of Object.entries(message.translations)) {
      ;(translations[locale] ??= []).push({ id: message.id, value })
    }
  return { copies, aliases, translations }
}

export function serializeCatalogTable(rows: readonly unknown[]): string {
  return `${canonicalJson([...rows].toSorted((a, b) => compareCodePoints(rowKey(a), rowKey(b))))}\n`
}

function rowKey(value: unknown): string {
  if (!object(value)) return ''
  return ['consumer', 'selectorId', 'alias', 'id'].map((key) => typeof value[key] === 'string' ? value[key] : '').join('\t')
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
