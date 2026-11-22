import { describe, expect, it } from 'vitest'

import { isUniqueViolation } from './unique-violation.mts'

describe('isUniqueViolation', () => {
  it('matches the unique_violation SQLSTATE on error objects', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true)
    expect(isUniqueViolation(Object.assign(new Error('duplicate'), { code: '23505' }))).toBe(true)
  })

  it('rejects other codes and non-objects', () => {
    expect(isUniqueViolation({ code: '23503' })).toBe(false)
    expect(isUniqueViolation({})).toBe(false)
    expect(isUniqueViolation(null)).toBe(false)
    expect(isUniqueViolation('23505')).toBe(false)
  })
})
