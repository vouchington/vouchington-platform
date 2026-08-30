import { describe, expect, it } from 'vitest'

import { validatePolicy } from './policy.mts'

describe('validatePolicy', () => {
  it.each([
    { rating: { minimum: 1.5, maximum: 5 } },
    { rating: { minimum: 1, maximum: 4.5 } },
    { rating: { minimum: 5, maximum: 1 } },
    { count: { minimum: -1, maximum: 2 } },
    { count: { minimum: 1, maximum: 1.5 } },
    { count: { minimum: 3, maximum: 2 } },
    { targetTypes: null },
    { targetTypes: [] },
    { targetTypes: [''] },
    { targetTypes: ['model', 'model'] },
  ])('rejects invalid configuration %#', (overrides) => {
    expect(() => validatePolicy({ ...policy(), ...overrides } as never)).toThrow()
  })

  it('returns an independent allowlist for valid types', () => {
    expect(validatePolicy(policy())).toEqual(new Set(['model', 'provider']))
  })
})

function policy() {
  return {
    targetTypes: ['provider', 'model'],
    rating: { minimum: 1, maximum: 5 },
    count: { minimum: 1, maximum: 3 },
    comparison: () => true,
    canDelete: () => true,
    isTargetEligible: () => true,
  }
}
