import { describe, expect, it } from 'vitest'
import { isUuidv7, mintUuidv7, validateUuidv7 } from './uuidv7.mts'

describe('UUIDv7 helpers', () => {
  it('mints and validates UUIDv7 identifiers', () => {
    const value = mintUuidv7()
    expect(isUuidv7(value)).toBe(true)
    expect(validateUuidv7(value)).toBe(value)
  })

  it('rejects other UUID versions and non-UUID values', () => {
    expect(isUuidv7('00000000-0000-4000-8000-000000000000')).toBe(false)
    expect(() => validateUuidv7('invalid')).toThrow('Invalid UUIDv7')
  })
})
