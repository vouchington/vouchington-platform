import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  narrowLimitBounds,
  type QueryContract,
  requiredQueryEnum,
  requiredQueryString,
} from './index.mts'

describe('narrowLimitBounds', () => {
  const bounds = { min: 5, max: 100, default: 50 }

  it('returns the static bounds without runtime values', () => {
    expect(narrowLimitBounds(bounds)).toBe(bounds)
  })

  it('narrows max and default to the runtime values', () => {
    expect(narrowLimitBounds(bounds, { max: 30, default: 10 })).toEqual({
      min: 5,
      max: 30,
      default: 10,
    })
  })

  it('never widens the static range', () => {
    expect(narrowLimitBounds(bounds, { max: 500, default: 500 })).toEqual({
      min: 5,
      max: 100,
      default: 100,
    })
    expect(narrowLimitBounds(bounds, { max: 1, default: 1 })).toEqual({
      min: 5,
      max: 5,
      default: 5,
    })
  })

  it('types the narrowed max and default as numbers, not the static literals', () => {
    const narrowed = narrowLimitBounds({ min: 1, max: 100, default: 50 } as const, {
      max: 30,
      default: 10,
    })
    expectTypeOf(narrowed.max).toEqualTypeOf<number>()
    expectTypeOf(narrowed.default).toEqualTypeOf<number>()
    expectTypeOf(narrowed.min).toEqualTypeOf<1>()
  })

  it('keeps extra properties on the bounds', () => {
    expect(narrowLimitBounds({ ...bounds, paramName: 'limit' }, { max: 20, default: 20 })).toEqual({
      paramName: 'limit',
      min: 5,
      max: 20,
      default: 20,
    })
  })
})

describe('required query contracts', () => {
  it('marks string and enum parameters as required', () => {
    expect(requiredQueryString()).toEqual({ kind: 'string', required: true })
    expect(requiredQueryString({ description: 'Search text' })).toEqual({
      kind: 'string',
      description: 'Search text',
      required: true,
    })
    const contract: QueryContract = { q: requiredQueryString(), e: requiredQueryEnum(['a']) }
    expect(contract.q?.required).toBe(true)
    expect(requiredQueryEnum(['a', 'b'] as const)).toEqual({
      kind: 'enum',
      values: ['a', 'b'],
      required: true,
    })
  })
})
