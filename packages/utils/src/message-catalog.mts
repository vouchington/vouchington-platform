import {
  assertCatalog,
  isCatalogRecord,
  isMessageDescriptor,
} from './message-catalog-validation.mjs'
export { isCatalogRecord, isMessageDescriptor } from './message-catalog-validation.mjs'

type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other'
export type PluralForms = Readonly<{ other: string } & Partial<Record<PluralCategory, string>>>
export type PluralMessageDescriptor = Readonly<{
  kind: 'plural'
  valueParameter: string
  numberParameters?: readonly string[]
  forms: PluralForms
}>
export type SelectPluralMessageDescriptor = Readonly<{
  kind: 'select-plural'
  valueParameter: string
  selectParameter: string
  numberParameters?: readonly string[]
  cases: Readonly<Record<string, PluralForms>>
}>
export type MessageDescriptor = PluralMessageDescriptor | SelectPluralMessageDescriptor
type CatalogLeaf = string | MessageDescriptor
export type MessageCatalog = { readonly [key: string]: CatalogLeaf | MessageCatalog }
type DottedCatalog<Catalog extends MessageCatalog> = {
  [Key in keyof Catalog & string]: Key extends `${string}.${string}`
    ? true
    : Catalog[Key] extends MessageCatalog
      ? DottedCatalog<Catalog[Key]>
      : false
}[keyof Catalog & string]
type ValidCatalog<Catalog extends MessageCatalog> = string extends keyof Catalog
  ? unknown
  : true extends DottedCatalog<Catalog>
    ? never
    : unknown
export type MessageKey<Catalog extends MessageCatalog> = string extends keyof Catalog
  ? string
  : {
      [Key in keyof Catalog & string]: Catalog[Key] extends CatalogLeaf
        ? Key
        : Catalog[Key] extends MessageCatalog
          ? `${Key}.${MessageKey<Catalog[Key]>}`
          : never
    }[keyof Catalog & string]
export type MessageTranslator<Catalog extends MessageCatalog> = <Key extends MessageKey<Catalog>>(
  key: Key,
  parameters?: Readonly<Record<string, unknown>>,
) => string

const pluralRules = new Map<string, Intl.PluralRules>()

export function plural(
  valueParameter: string,
  forms: PluralForms,
  numberParameters?: readonly string[],
): PluralMessageDescriptor {
  const descriptor = {
    kind: 'plural',
    valueParameter,
    ...(numberParameters && { numberParameters }),
    forms,
  } as const
  if (!isMessageDescriptor(descriptor)) throw new TypeError('Invalid plural message descriptor')
  return descriptor
}

export function selectPlural(
  valueParameter: string,
  selectParameter: string,
  cases: Readonly<Record<string, PluralForms>>,
  numberParameters?: readonly string[],
): SelectPluralMessageDescriptor {
  const descriptor = {
    kind: 'select-plural',
    valueParameter,
    selectParameter,
    ...(numberParameters && { numberParameters }),
    cases,
  } as const
  if (!isMessageDescriptor(descriptor))
    throw new TypeError('Invalid select-plural message descriptor')
  return descriptor
}

export function createMessageTranslator<Catalog extends MessageCatalog>(
  locale: string,
  catalog: Catalog & ValidCatalog<Catalog>,
  options: { formatNumber?: (value: number, locale: string) => string } = {},
): MessageTranslator<Catalog> {
  assertCatalog(catalog)
  return (key, parameters = {}) => {
    const leaf = resolve(catalog, key)
    if (typeof leaf === 'string') return interpolate(leaf, parameters)
    if (!isMessageDescriptor(leaf))
      throw new Error(`Message key "${key}" resolves to a non-leaf value`)
    const numeric = readNumericParameters(leaf, parameters)
    const forms = leaf.kind === 'plural' ? leaf.forms : selectForms(leaf, parameters)
    const template =
      forms[getPluralRules(locale).select(numeric.get(leaf.valueParameter)!)] ?? forms.other
    const formatted = { ...parameters }
    for (const parameter of leaf.numberParameters ?? [])
      formatted[parameter] =
        options.formatNumber?.(numeric.get(parameter)!, locale) ?? String(numeric.get(parameter))
    return interpolate(template, formatted)
  }
}

function resolve(catalog: MessageCatalog, key: string): unknown {
  let value: unknown = catalog
  for (const segment of key.split('.')) {
    if (!isCatalogRecord(value) || !Object.hasOwn(value, segment))
      throw new Error(`Unresolvable message key "${key}" at "${segment}"`)
    value = value[segment]
  }
  return value
}

function readNumericParameters(
  descriptor: MessageDescriptor,
  parameters: Readonly<Record<string, unknown>>,
): ReadonlyMap<string, number> {
  const numeric = new Map<string, number>()
  for (const parameter of new Set([
    descriptor.valueParameter,
    ...(descriptor.numberParameters ?? []),
  ])) {
    const value = parameters[parameter]
    if (
      !Object.hasOwn(parameters, parameter) ||
      typeof value !== 'number' ||
      !Number.isFinite(value)
    )
      throw new TypeError(`Message parameter "${parameter}" must be a finite number`)
    numeric.set(parameter, value)
  }
  return numeric
}

function selectForms(
  descriptor: SelectPluralMessageDescriptor,
  parameters: Readonly<Record<string, unknown>>,
): PluralForms {
  const selected = String(parameters[descriptor.selectParameter])
  if (!Object.hasOwn(descriptor.cases, selected))
    throw new Error(`Unknown select-plural case "${selected}" for "${descriptor.selectParameter}"`)
  return descriptor.cases[selected]!
}

function interpolate(template: string, parameters: Readonly<Record<string, unknown>>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(parameters, name) ? String(parameters[name]) : match,
  )
}

function getPluralRules(locale: string): Intl.PluralRules {
  const cached = pluralRules.get(locale)
  if (cached) return cached
  const rules = new Intl.PluralRules(locale)
  pluralRules.set(locale, rules)
  return rules
}
