import { describe, expect, it } from 'vitest'
import { isEmailAddress, isUuid } from './validation.mts'

describe('validation', () => {
  it('checks basic email addresses and UUIDs', () => {
    expect(isEmailAddress('a@example.test')).toBe(true)
    expect(isEmailAddress('bad address')).toBe(false)
    expect(isUuid('01234567-89ab-cdef-0123-456789abcdef')).toBe(true)
    expect(isUuid('no')).toBe(false)
  })
})
