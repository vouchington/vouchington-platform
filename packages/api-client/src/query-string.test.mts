import { describe, expect, it } from 'vitest'
import { buildQueryString } from './query-string.mts'

describe('buildQueryString', () => {
  it('serializes defined params and skips undefined', () => {
    expect(buildQueryString({ a: 1, b: 'x y', c: false, d: undefined })).toBe('?a=1&b=x+y&c=false')
  })

  it('returns an empty string when nothing remains', () => {
    expect(buildQueryString({})).toBe('')
    expect(buildQueryString({ a: undefined })).toBe('')
  })
})
