export const MAX_MONEY_AMOUNT = Number.MAX_SAFE_INTEGER

export type Currency<Code extends string = string> = { code: Code; minorUnitExponent: number }
export type Money<Code extends string = string> = { amount: number; currency: Code }
export type ScaledMoney<Code extends string = string> = Money<Code> & { scale: number }
export type ScaledMoneyAggregate<Code extends string = string> = {
  amount: string
  currency: Code
  scale: number
}
export type MoneyRange<Code extends string = string> = {
  minimum: Money<Code>
  maximum: Money<Code> | null
}

export function createMoneyCatalog<const Currencies extends readonly Currency[]>(
  entries: Currencies,
  scale: number,
) {
  validateScale(scale)
  for (const currency of entries) validateCurrency(currency, scale)
  const copiedEntries = entries.map((currency) => Object.freeze({ ...currency }))
  const currencies = new Map(copiedEntries.map((currency) => [currency.code, currency]))
  if (currencies.size !== entries.length) throw new Error('Currency codes must be unique')
  type Code = Currencies[number]['code']
  return {
    currencies: Object.freeze(copiedEntries),
    scale,
    isCurrencyCode: (value: unknown): value is Code =>
      typeof value === 'string' && currencies.has(value as Code),
    getCurrency: (code: Code): Currency<Code> => currencies.get(code) ?? invalidCurrency(code),
    isMoney: (value: unknown): value is Money<Code> => isMoneyValue(value, currencies),
    isScaledMoney: (value: unknown): value is ScaledMoney<Code> =>
      isScaledMoneyValue(value, currencies, scale),
    isScaledMoneyAggregate: (value: unknown): value is ScaledMoneyAggregate<Code> =>
      isScaledAggregateValue(value, currencies, scale),
    isMoneyRange: (value: unknown): value is MoneyRange<Code> =>
      isMoneyRangeValue(value, currencies),
    parseMajorUnitsToMoney: (value: string, currency: Code): Money<Code> => ({
      amount: parseMajorUnits(
        value,
        (currencies.get(currency) ?? invalidCurrency(currency)).minorUnitExponent,
      ),
      currency,
    }),
    parseMajorUnitsToScaledMoney: (value: string, currency: Code): ScaledMoney<Code> => ({
      amount: parseMajorUnits(value, currencies.has(currency) ? scale : invalidCurrency(currency)),
      currency,
      scale,
    }),
  }
}

export function parsePostgresMoneyAmount(value: string): number {
  if (!isCanonicalInteger(value))
    throw new TypeError('Stored money amount must be a canonical non-negative integer')
  const amount = BigInt(value)
  if (amount > BigInt(MAX_MONEY_AMOUNT))
    throw new RangeError('Stored money amount exceeds the maximum JSON-safe integer')
  return Number(amount)
}

function validateScale(scale: number): void {
  if (!Number.isInteger(scale) || scale < 0 || scale > 15)
    throw new RangeError('Scale must be 0 through 15')
}
function validateCurrency(currency: Currency, scale: number): void {
  if (
    !currency.code ||
    !Number.isInteger(currency.minorUnitExponent) ||
    currency.minorUnitExponent < 0 ||
    currency.minorUnitExponent > scale
  )
    throw new TypeError('Currencies require a non-empty code and an integer exponent within scale')
}
function invalidCurrency(code: string): never {
  throw new TypeError(`Unknown currency: ${code}`)
}
function isMoneyValue(value: unknown, currencies: ReadonlyMap<string, Currency>): value is Money {
  const fields = fieldsOf(value, ['amount', 'currency'])
  return fields !== null && isAmount(fields.amount) && hasCurrency(currencies, fields.currency)
}
function isScaledMoneyValue(
  value: unknown,
  currencies: ReadonlyMap<string, Currency>,
  scale: number,
): value is ScaledMoney {
  const fields = fieldsOf(value, ['amount', 'currency', 'scale'])
  return (
    fields !== null &&
    isAmount(fields.amount) &&
    hasCurrency(currencies, fields.currency) &&
    fields.scale === scale
  )
}
function isScaledAggregateValue(
  value: unknown,
  currencies: ReadonlyMap<string, Currency>,
  scale: number,
): value is ScaledMoneyAggregate {
  const fields = fieldsOf(value, ['amount', 'currency', 'scale'])
  return (
    fields !== null &&
    isCanonicalInteger(fields.amount) &&
    hasCurrency(currencies, fields.currency) &&
    fields.scale === scale
  )
}
function isMoneyRangeValue(
  value: unknown,
  currencies: ReadonlyMap<string, Currency>,
): value is MoneyRange {
  const fields = fieldsOf(value, ['minimum', 'maximum'])
  return (
    fields !== null &&
    isMoneyValue(fields.minimum, currencies) &&
    (fields.maximum === null ||
      (isMoneyValue(fields.maximum, currencies) &&
        fields.maximum.currency === fields.minimum.currency &&
        fields.maximum.amount > fields.minimum.amount))
  )
}
function hasCurrency(currencies: ReadonlyMap<string, Currency>, value: unknown): value is string {
  return typeof value === 'string' && currencies.has(value)
}
function parseMajorUnits(value: string, scale: number): number {
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(value)
  if (!match) throw new TypeError('Money must be a non-negative plain decimal string')
  const fractional = match[2] ?? ''
  if (fractional.length > scale)
    throw new RangeError(`Money supports at most ${scale} decimal places`)
  const amount = BigInt(match[1]!) * 10n ** BigInt(scale) + BigInt(fractional.padEnd(scale, '0'))
  if (amount > BigInt(MAX_MONEY_AMOUNT))
    throw new RangeError('Money exceeds the maximum JSON-safe integer amount')
  return Number(amount)
}
function isAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
function isCanonicalInteger(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value)
}
function fieldsOf(value: unknown, expected: readonly string[]): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  try {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return null
    const keys = Reflect.ownKeys(value)
    if (keys.length !== expected.length || !expected.every((key) => Object.hasOwn(value, key)))
      return null
    const fields: Record<string, unknown> = {}
    for (const key of expected) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !('value' in descriptor)) return null
      fields[key] = descriptor.value
    }
    return fields
  } catch {
    return null
  }
}
