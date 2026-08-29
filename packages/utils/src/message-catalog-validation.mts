import type { MessageCatalog, MessageDescriptor, PluralForms } from './message-catalog.mjs'

const pluralCategories = ['zero', 'one', 'two', 'few', 'many', 'other'] as const

class CatalogValidationError extends TypeError {}

export function isMessageDescriptor(value: unknown): value is MessageDescriptor {
  try {
    if (
      !isCatalogRecord(value) ||
      !hasOwnString(value, 'kind') ||
      !hasOwnString(value, 'valueParameter') ||
      !isStringArray(value.numberParameters)
    )
      return false
    if (value.kind === 'plural')
      return (
        hasOnlyKeys(value, ['kind', 'valueParameter', 'numberParameters', 'forms']) &&
        Object.hasOwn(value, 'forms') &&
        isPluralForms(value.forms)
      )
    return (
      value.kind === 'select-plural' &&
      hasOnlyKeys(value, [
        'kind',
        'valueParameter',
        'selectParameter',
        'numberParameters',
        'cases',
      ]) &&
      hasOwnString(value, 'selectParameter') &&
      Object.hasOwn(value, 'cases') &&
      isCases(value.cases)
    )
  } catch {
    return false
  }
}

export function assertCatalog(value: unknown, path = 'catalog'): asserts value is MessageCatalog {
  assertCatalogValue(value, path, new WeakSet())
}

export function isCatalogRecord(value: unknown): value is Record<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
    const prototype = Object.getPrototypeOf(value)
    if ((prototype !== Object.prototype && prototype !== null) || Object.hasOwn(value, 'toJSON'))
      return false
    return Object.values(Object.getOwnPropertyDescriptors(value)).every(
      (descriptor) =>
        descriptor.enumerable && 'value' in descriptor && typeof descriptor.value !== 'function',
    )
  } catch {
    return false
  }
}

function assertCatalogValue(
  value: unknown,
  path: string,
  ancestors: WeakSet<object>,
): asserts value is MessageCatalog {
  if (!isCatalogRecord(value)) fail(`${path} must be a serializable catalog object`)
  if (ancestors.has(value)) fail(`${path} contains a catalog cycle`)
  ancestors.add(value)
  try {
    for (const [key, child] of Object.entries(value)) {
      if (key.includes('.')) fail(`segment "${key}" must not contain a dot`)
      if (typeof child === 'string' || isMessageDescriptor(child)) continue
      if (isCatalogRecord(child) && child.kind === 'plural')
        fail(`Invalid plural message descriptor at "${key}"`)
      if (isCatalogRecord(child) && child.kind === 'select-plural')
        fail(`Invalid select-plural message descriptor at "${key}"`)
      assertCatalogValue(child, `${path}.${key}`, ancestors)
    }
  } catch (error) {
    if (error instanceof CatalogValidationError) throw error
    fail(`${path} must be a serializable catalog object`)
  } finally {
    ancestors.delete(value)
  }
}

function isCases(value: unknown): value is Readonly<Record<string, PluralForms>> {
  return (
    isCatalogRecord(value) &&
    Object.keys(value).length > 0 &&
    Object.values(value).every(isPluralForms)
  )
}

function isPluralForms(value: unknown): value is PluralForms {
  return (
    isCatalogRecord(value) &&
    Object.hasOwn(value, 'other') &&
    Object.keys(value).every(
      (key) =>
        pluralCategories.includes(key as (typeof pluralCategories)[number]) &&
        typeof value[key] === 'string',
    )
  )
}

function hasOwnString(value: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(value, key) && typeof value[key] === 'string'
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
}

function isStringArray(value: unknown): value is readonly string[] | undefined {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      !Object.hasOwn(value, 'toJSON') &&
      Array.from(value).every((item) => typeof item === 'string'))
  )
}

function fail(message: string): never {
  throw new CatalogValidationError(message)
}
