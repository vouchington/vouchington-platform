import { describe, expect, it } from 'vitest'
import { createMoneyCatalog, parsePostgresMoneyAmount } from './money.mts'

const money = createMoneyCatalog(
  [
    { code: 'alpha', minorUnitExponent: 2 },
    { code: 'beta', minorUnitExponent: 0 },
  ] as const,
  4,
)

describe('money catalog', () => {
  it('uses caller-supplied currencies and scale', () => {
    expect(money.parseMajorUnitsToMoney('12.34', 'alpha')).toEqual({
      amount: 1234,
      currency: 'alpha',
    })
    expect(money.parseMajorUnitsToMoney('12', 'beta')).toEqual({ amount: 12, currency: 'beta' })
    expect(money.parseMajorUnitsToScaledMoney('0.035', 'alpha')).toEqual({
      amount: 350,
      currency: 'alpha',
      scale: 4,
    })
    expect(money.getCurrency('alpha')).toEqual({ code: 'alpha', minorUnitExponent: 2 })
    expect(money.isCurrencyCode('alpha')).toBe(true)
    expect(money.isCurrencyCode('usd')).toBe(false)

    const mutable = { code: 'mutable', minorUnitExponent: 2 }
    const copied = createMoneyCatalog([mutable] as const, 4)
    mutable.code = 'changed'
    mutable.minorUnitExponent = 0
    expect(copied.getCurrency('mutable')).toEqual({ code: 'mutable', minorUnitExponent: 2 })
    expect(Object.isFrozen(copied.currencies[0])).toBe(true)
  })

  it('validates exact values, ranges, and PostgreSQL integer strings', () => {
    expect(money.isMoney({ amount: 1, currency: 'alpha' })).toBe(true)
    expect(money.isMoney({ amount: -1, currency: 'alpha' })).toBe(false)
    expect(money.isMoney(null)).toBe(false)
    expect(money.isMoney(new Date())).toBe(false)
    expect(money.isMoney({ amount: 1, currency: 'alpha', extra: true })).toBe(false)
    expect(
      money.isMoney(
        Object.create(null, {
          amount: { value: 1, enumerable: true },
          currency: { value: 'alpha', enumerable: true },
        }),
      ),
    ).toBe(true)
    expect(money.isScaledMoney({ amount: 1, currency: 'alpha', scale: 4 })).toBe(true)
    expect(money.isScaledMoneyAggregate({ amount: '1', currency: 'alpha', scale: 4 })).toBe(true)
    expect(
      money.isMoney(
        Object.defineProperty({ currency: 'alpha' }, 'amount', { enumerable: true, get: () => 1 }),
      ),
    ).toBe(false)
    expect(
      money.isMoneyRange({
        minimum: { amount: 1, currency: 'alpha' },
        maximum: { amount: 2, currency: 'alpha' },
      }),
    ).toBe(true)
    expect(
      money.isMoneyRange({
        minimum: { amount: 1, currency: 'alpha' },
        maximum: { amount: 2, currency: 'beta' },
      }),
    ).toBe(false)
    expect(parsePostgresMoneyAmount('0')).toBe(0)
    expect(() => parsePostgresMoneyAmount('01')).toThrow(TypeError)
    expect(() => parsePostgresMoneyAmount('9007199254740992')).toThrow(RangeError)
  })

  it('rejects invalid catalogs, values, and adversarial records', () => {
    expect(() =>
      createMoneyCatalog(
        [
          { code: 'same', minorUnitExponent: 2 },
          { code: 'same', minorUnitExponent: 2 },
        ],
        2,
      ),
    ).toThrow('unique')
    expect(() => createMoneyCatalog([{ code: '', minorUnitExponent: 2 }], 2)).toThrow('non-empty')
    expect(() => createMoneyCatalog([{ code: 'ok', minorUnitExponent: -1 }], 2)).toThrow('within')
    expect(() => createMoneyCatalog([{ code: 'ok', minorUnitExponent: 3 }], 2)).toThrow('within')
    expect(() => createMoneyCatalog([{ code: 'ok', minorUnitExponent: 2 }], 16)).toThrow('Scale')
    expect(() => money.parseMajorUnitsToMoney('1.001', 'alpha')).toThrow(RangeError)
    expect(() => money.parseMajorUnitsToMoney('-1', 'alpha')).toThrow(TypeError)
    expect(() => money.parseMajorUnitsToMoney('90071992547409.92', 'alpha')).toThrow(RangeError)
    expect(() => money.getCurrency('missing' as never)).toThrow('Unknown')
    expect(() => money.parseMajorUnitsToMoney('1', 'missing' as never)).toThrow('Unknown')
    expect(() => money.parseMajorUnitsToScaledMoney('1', 'missing' as never)).toThrow('Unknown')
    expect(
      money.isMoney(
        new Proxy(
          {},
          {
            getPrototypeOf: () => {
              throw new Error('blocked')
            },
          },
        ),
      ),
    ).toBe(false)
  })
})
