import { describe, expect, it } from 'vitest'
import { isValidGtinCheckDigit, isValidGtinFormat } from './gtin.mts'

describe('GTIN', () => {
  it('validates supported GTIN lengths and check digits', () => {
    expect(isValidGtinFormat('4006381333931')).toBe(true)
    expect(isValidGtinFormat('123')).toBe(false)
    expect(isValidGtinCheckDigit('4006381333931')).toBe(true)
    expect(isValidGtinCheckDigit('96385074')).toBe(true)
    expect(isValidGtinCheckDigit('4006381333932')).toBe(false)
    expect(isValidGtinCheckDigit('bad')).toBe(false)
  })
})
