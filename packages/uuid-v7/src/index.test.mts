import { describe, expect, it } from 'vitest'
import {
  getDateFromUuidv7,
  getMaxUuidv7ForDate,
  getMinUuidv7ForDate,
  isUuidv7,
  mintUuidv7,
  uuidv7RandomToBase36,
  validateUuidv7,
} from './index.mts'
describe('UUIDv7', () => {
  it('mints, validates, extracts dates, and produces chronological bounds', () => {
    const date = new Date('2026-01-02T03:04:05.678Z')
    const value = mintUuidv7()
    expect(isUuidv7(value)).toBe(true)
    expect(validateUuidv7(value)).toBe(value)
    expect(getDateFromUuidv7(getMinUuidv7ForDate(date))?.getTime()).toBe(date.getTime())
    expect(getMinUuidv7ForDate(date) < getMaxUuidv7ForDate(date)).toBe(true)
  })
  it('rejects invalid values and converts the random suffix to base36', () => {
    expect(isUuidv7('00000000-0000-4000-8000-000000000000')).toBe(false)
    expect(getDateFromUuidv7('invalid')).toBeNull()
    expect(() => validateUuidv7('invalid')).toThrow('Invalid UUIDv7')
    expect(uuidv7RandomToBase36(getMaxUuidv7ForDate(new Date(0)))).toMatch(/^[0-9a-z]+$/)
    expect(() => uuidv7RandomToBase36('invalid')).toThrow('Invalid UUIDv7')
    expect(() => getMinUuidv7ForDate(new Date(Number.NaN))).toThrow('Invalid date')
  })
})
