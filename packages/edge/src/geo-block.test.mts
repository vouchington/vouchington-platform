import { describe, expect, it } from 'vitest'
import { isGeoBlocked, parseBlockedCountries } from './geo-block.mts'

describe('parseBlockedCountries', () => {
  it.each([undefined, '', '   ', ' , , '])('returns null for %j', (value) => {
    expect(parseBlockedCountries(value)).toBeNull()
  })

  it('normalizes case, trims, and drops empty segments', () => {
    expect(parseBlockedCountries(' aa , Bb,,CC, ')).toEqual(new Set(['AA', 'BB', 'CC']))
  })
})

describe('isGeoBlocked', () => {
  const blocked = new Set(['AA', 'BB'])
  const headers = (entries: Record<string, string>) => new Headers(entries)

  it('allows everything when blocking is disabled', () => {
    expect(isGeoBlocked(headers({ 'cf-ray': 'x', 'cf-ipcountry': 'AA' }), null)).toBe(false)
  })

  it('allows requests that did not transit the edge', () => {
    expect(isGeoBlocked(headers({ 'cf-ipcountry': 'AA' }), blocked)).toBe(false)
  })

  it('fails closed on the edge without a country', () => {
    expect(isGeoBlocked(headers({ 'cf-ray': 'x' }), blocked)).toBe(true)
  })

  it('blocks listed countries case-insensitively and allows others', () => {
    expect(isGeoBlocked(headers({ 'cf-ray': 'x', 'cf-ipcountry': 'aa' }), blocked)).toBe(true)
    expect(isGeoBlocked(headers({ 'cf-ray': 'x', 'cf-ipcountry': 'ZZ' }), blocked)).toBe(false)
  })

  it('honors injected header names', () => {
    const names = { edgePresence: 'x-edge', country: 'x-country' }
    expect(isGeoBlocked(headers({ 'x-edge': '1', 'x-country': 'BB' }), blocked, names)).toBe(true)
    expect(isGeoBlocked(headers({ 'cf-ray': 'x', 'cf-ipcountry': 'BB' }), blocked, names)).toBe(
      false,
    )
  })
})
