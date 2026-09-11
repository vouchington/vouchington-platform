import { compareCodePoints } from './compare.mts'
import type {
  LocalizationLeaf,
  LocalizationSelector,
  MessageDescriptor,
  PluralForms,
  TranslationValue,
} from './types.mts'
import { selectorMatches } from './selectors.mts'

export function selectedIds(
  ids: readonly string[],
  selectors: readonly LocalizationSelector[],
): string[] {
  return ids
    .filter((id) => selectors.some((selector) => selectorMatches(selector, id)))
    .toSorted(compareCodePoints)
}

export function firstAvailableTranslation(
  locales: readonly string[],
  translations: Readonly<Record<string, TranslationValue>>,
): TranslationValue | undefined {
  for (const locale of locales) {
    if (Object.hasOwn(translations, locale)) return translations[locale]
  }
  return undefined
}

export function leafForTranslation(
  descriptor: MessageDescriptor | null,
  value: TranslationValue,
): LocalizationLeaf {
  if (descriptor === null) {
    if (typeof value !== 'string')
      throw new TypeError('String messages require string translations')
    return value
  }
  if (descriptor.kind === 'plural') {
    if (!isPluralForms(value))
      throw new TypeError('Plural messages require plural-form translations')
    return descriptor.numberParameters === undefined
      ? { kind: 'plural', valueParameter: descriptor.valueParameter, forms: value }
      : {
          kind: 'plural',
          valueParameter: descriptor.valueParameter,
          numberParameters: descriptor.numberParameters,
          forms: value,
        }
  }
  if (typeof value === 'string' || isPluralForms(value)) {
    throw new TypeError('Select-plural messages require cased translations')
  }
  return descriptor.numberParameters === undefined
    ? {
        kind: 'select-plural',
        valueParameter: descriptor.valueParameter,
        selectParameter: descriptor.selectParameter,
        cases: value,
      }
    : {
        kind: 'select-plural',
        valueParameter: descriptor.valueParameter,
        selectParameter: descriptor.selectParameter,
        numberParameters: descriptor.numberParameters,
        cases: value,
      }
}

function isPluralForms(value: TranslationValue): value is PluralForms {
  return (
    typeof value === 'object' && Object.hasOwn(value, 'other') && typeof value.other === 'string'
  )
}
