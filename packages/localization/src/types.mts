export const LOCALIZATION_CONSUMERS = ['web', 'swift', 'dotnet', 'email'] as const
export const PUBLIC_LOCALIZATION_CONSUMERS = ['web', 'swift', 'dotnet'] as const
export const LOCALIZATION_WIRE_CONTRACT = 'v1' as const
export const CANONICAL_SOURCE_LOCALE = 'en-US' as const
export const ENGLISH_LOCALE_ALIAS = 'en' as const
export const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const

export type LocalizationConsumer = (typeof LOCALIZATION_CONSUMERS)[number]
export type PublicLocalizationConsumer = (typeof PUBLIC_LOCALIZATION_CONSUMERS)[number]
export type LocalizationWireContract = typeof LOCALIZATION_WIRE_CONTRACT
export type PluralCategory = (typeof PLURAL_CATEGORIES)[number]
export type PluralForms = Readonly<{ other: string } & Partial<Record<PluralCategory, string>>>
export type SelectPluralCases = Readonly<Record<string, PluralForms>>
export type TranslationValue = string | PluralForms | SelectPluralCases
export type PluralDescriptor = Readonly<{
  kind: 'plural'
  valueParameter: string
  numberParameters?: readonly string[]
}>
export type SelectPluralDescriptor = Readonly<{
  kind: 'select-plural'
  valueParameter: string
  selectParameter: string
  numberParameters?: readonly string[]
  cases: readonly string[]
}>
export type MessageDescriptor = PluralDescriptor | SelectPluralDescriptor
export type ExactSelector = Readonly<{ kind: 'exact'; id: string }>
export type PrefixSelector = Readonly<{ kind: 'prefix'; prefix: string }>
export type LocalizationSelector = ExactSelector | PrefixSelector
export type CatalogMessage = Readonly<{
  id: string
  descriptor: MessageDescriptor | null
  consumers: readonly LocalizationConsumer[]
  translations: Readonly<Record<string, TranslationValue>>
}>
export type LocalizationRequest = Readonly<{
  consumer: LocalizationConsumer
  locales: readonly string[]
  selectors: readonly string[]
}>
export type NormalizedLocalizationRequest = Readonly<{
  consumer: LocalizationConsumer
  locales: readonly string[]
  selectors: readonly LocalizationSelector[]
}>
export type LocalizationBounds = Readonly<{
  maxLocales: number
  maxSelectors: number
  maxMessages: number
  maxBytes: number
}>
export type LocalizationLeaf =
  | string
  | Readonly<PluralDescriptor & { forms: PluralForms }>
  | Readonly<Omit<SelectPluralDescriptor, 'cases'> & { cases: SelectPluralCases }>
export type LocalizationBatch = Readonly<{
  contract: LocalizationWireContract
  revision: string
  ttlSeconds: number
  messages: Readonly<Record<string, LocalizationLeaf>>
}>
