import {
  CANONICAL_SOURCE_LOCALE,
  ENGLISH_LOCALE_ALIAS,
  catalogMessageFromRecord,
  compareCodePoints,
  descriptorSignature,
  isPluralForms,
  isSelectPluralCases,
  normalizeLocale,
  placeholdersIn,
  type CatalogMessage,
  type MessageDescriptor,
  type TranslationValue,
} from '@vouchington/localization'

export function validateCatalogMessages(messages: readonly CatalogMessage[]): void {
  const seen = new Set<string>()
  for (const message of messages) {
    if (seen.has(message.id)) throw new TypeError(`Duplicate message id "${message.id}"`)
    seen.add(message.id)
    if (!Object.hasOwn(message.translations, CANONICAL_SOURCE_LOCALE)) {
      throw new TypeError(`Message "${message.id}" is missing ${CANONICAL_SOURCE_LOCALE}`)
    }
    const canonical = message.translations[CANONICAL_SOURCE_LOCALE]!
    assertValueMatchesDescriptor(message.id, CANONICAL_SOURCE_LOCALE, message.descriptor, canonical)
    const expected = placeholdersFor(canonical)
    for (const [locale, value] of Object.entries(message.translations)) {
      const normalized = normalizeLocale(locale)
      if (normalized === null) throw new TypeError(`Invalid locale "${locale}" on "${message.id}"`)
      if (locale === ENGLISH_LOCALE_ALIAS || locale !== normalized) {
        throw new TypeError(`Locale "${locale}" on "${message.id}" must be stored as ${normalized}`)
      }
      assertValueMatchesDescriptor(message.id, locale, message.descriptor, value)
      if (message.descriptor?.kind === 'select-plural') {
        assertSelectCases(message.id, locale, message.descriptor, value)
      }
      if (expected.join(',') !== placeholdersFor(value).join(',')) {
        throw new TypeError(`Placeholder mismatch for "${message.id}" in ${locale}`)
      }
    }
  }
}

export function parseCatalogFile(value: unknown): CatalogMessage[] {
  const records = Array.isArray(value) ? value : isMessagesDocument(value) ? value.messages : null
  if (records === null)
    throw new TypeError('Catalog file must be an array or { messages } document')
  return records.map((record) => catalogMessageFromRecord(record))
}

function placeholdersFor(value: TranslationValue): string[] {
  const names =
    typeof value === 'string'
      ? placeholdersIn(value)
      : isPluralForms(value)
        ? Object.values(value).flatMap(placeholdersIn)
        : Object.values(value).flatMap((forms) => Object.values(forms).flatMap(placeholdersIn))
  return [...new Set(names)].toSorted(compareCodePoints)
}

function assertValueMatchesDescriptor(
  id: string,
  locale: string,
  descriptor: MessageDescriptor | null,
  value: TranslationValue,
): void {
  if (descriptor === null && typeof value !== 'string') {
    throw new TypeError(`String message "${id}" has a non-string value in ${locale}`)
  }
  if (descriptor?.kind === 'plural' && !isPluralForms(value)) {
    throw new TypeError(`Plural message "${id}" has invalid forms in ${locale}`)
  }
  if (descriptor?.kind === 'select-plural' && (typeof value === 'string' || isPluralForms(value))) {
    throw new TypeError(`Select-plural message "${id}" has invalid cases in ${locale}`)
  }
}

function assertSelectCases(
  id: string,
  locale: string,
  descriptor: MessageDescriptor & { kind: 'select-plural' },
  value: TranslationValue,
): void {
  if (typeof value === 'string' || isPluralForms(value) || !isSelectPluralCases(value)) {
    throw new TypeError(`Select-plural message "${id}" has invalid cases in ${locale}`)
  }
  const actual = descriptorSignature({ ...descriptor, cases: Object.keys(value) })
  if (descriptorSignature(descriptor) !== actual) {
    throw new TypeError(`Select-plural cases mismatch for "${id}" in ${locale}`)
  }
}

function isMessagesDocument(value: unknown): value is { messages: unknown[] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { messages?: unknown }).messages)
  )
}
