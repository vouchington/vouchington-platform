import { describe, expect, it } from 'vitest'
import { isPhoneNumber, normalizePhoneNumber } from './index.mts'
describe('phone validation', () => {
  it('returns normalized E.164 strings or null without throwing HTTP errors', () => {
    expect(normalizePhoneNumber('+1 202-555-0123')).toBe('+12025550123')
    expect(normalizePhoneNumber('not a phone')).toBeNull()
    expect(isPhoneNumber('+44 7911 123456')).toBe(true)
    expect(isPhoneNumber('12345')).toBe(false)
  })
})
