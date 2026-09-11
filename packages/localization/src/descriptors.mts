import { compareCodePoints } from './compare.mts'
import {
  PLURAL_CATEGORIES,
  type MessageDescriptor,
  type PluralForms,
  type TranslationValue,
} from './types.mts'

const PLURAL_KEYS = new Set<string>(PLURAL_CATEGORIES)

export function isPluralForms(value: unknown): value is PluralForms {
  if (!isPlainObject(value) || typeof value.other !== 'string') return false
  return Object.entries(value).every(
    ([key, form]) => PLURAL_KEYS.has(key) && typeof form === 'string',
  )
}

export function isSelectPluralCases(
  value: unknown,
): value is Readonly<Record<string, PluralForms>> {
  return (
    isPlainObject(value) &&
    Object.keys(value).length > 0 &&
    Object.values(value).every(isPluralForms)
  )
}

export function isTranslationValue(value: unknown): value is TranslationValue {
  return typeof value === 'string' || isPluralForms(value) || isSelectPluralCases(value)
}

export function descriptorSignature(descriptor: MessageDescriptor): string {
  return JSON.stringify({
    kind: descriptor.kind,
    valueParameter: descriptor.valueParameter,
    selectParameter: descriptor.kind === 'select-plural' ? descriptor.selectParameter : null,
    numberParameters: [...(descriptor.numberParameters ?? [])].toSorted(compareCodePoints),
    cases:
      descriptor.kind === 'select-plural' ? [...descriptor.cases].toSorted(compareCodePoints) : [],
  })
}

export function parseDescriptor(value: unknown): MessageDescriptor | null {
  if (value === null) return null
  if (
    !isPlainObject(value) ||
    typeof value.kind !== 'string' ||
    typeof value.valueParameter !== 'string'
  ) {
    throw new TypeError('Invalid message descriptor')
  }
  const numberParameters = optionalStringArray(value.numberParameters)
  if (value.kind === 'plural') {
    assertNoKeys(value, ['kind', 'valueParameter', 'numberParameters'])
    return numberParameters === undefined
      ? { kind: 'plural', valueParameter: value.valueParameter }
      : { kind: 'plural', valueParameter: value.valueParameter, numberParameters }
  }
  if (value.kind !== 'select-plural' || typeof value.selectParameter !== 'string') {
    throw new TypeError('Invalid message descriptor')
  }
  const cases = value.cases
  if (
    !Array.isArray(cases) ||
    cases.length === 0 ||
    cases.some((item) => typeof item !== 'string')
  ) {
    throw new TypeError('Invalid select-plural descriptor cases')
  }
  assertNoKeys(value, ['kind', 'valueParameter', 'selectParameter', 'numberParameters', 'cases'])
  return numberParameters === undefined
    ? {
        kind: 'select-plural',
        valueParameter: value.valueParameter,
        selectParameter: value.selectParameter,
        cases: [...cases],
      }
    : {
        kind: 'select-plural',
        valueParameter: value.valueParameter,
        selectParameter: value.selectParameter,
        numberParameters,
        cases: [...cases],
      }
}

function optionalStringArray(value: unknown): readonly string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new TypeError('Descriptor numberParameters must be a string array')
  }
  return [...value]
}

function assertNoKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new TypeError('Invalid message descriptor')
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
