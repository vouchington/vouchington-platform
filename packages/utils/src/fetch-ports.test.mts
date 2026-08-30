import { describe, expect, it } from 'vitest'
import { FETCH_FORBIDDEN_PORTS, isFetchForbiddenPort, isFetchSafePort } from './fetch-ports.mts'

describe('Fetch forbidden ports', () => {
  it('exposes the Fetch standard list as immutable policy data', () => {
    expect(FETCH_FORBIDDEN_PORTS).toContain(1)
    expect(FETCH_FORBIDDEN_PORTS).toContain(10080)
    expect(Object.isFrozen(FETCH_FORBIDDEN_PORTS)).toBe(true)
  })

  it('classifies forbidden and safe ports', () => {
    expect(isFetchForbiddenPort(22)).toBe(true)
    expect(isFetchSafePort(22)).toBe(false)
    expect(isFetchForbiddenPort(443)).toBe(false)
    expect(isFetchSafePort(443)).toBe(true)
    expect(isFetchSafePort(0)).toBe(true)
    expect(isFetchSafePort(Number.NaN)).toBe(false)
    expect(isFetchSafePort(-1)).toBe(false)
    expect(isFetchSafePort(1.5)).toBe(false)
    expect(isFetchSafePort(65_536)).toBe(false)
  })
})
