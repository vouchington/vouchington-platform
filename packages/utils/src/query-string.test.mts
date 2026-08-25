import { describe, expect, it } from 'vitest'
import { buildQueryString } from './query-string.mts'

describe('query-string', () => {
  it('serializes scalar and repeated values and omits absent values', () => {
    expect(
      buildQueryString({ q: 'hello world', ids: [1, 'two'], empty: null, absent: undefined }),
    ).toBe('?q=hello+world&ids=1&ids=two')
    expect(buildQueryString({})).toBe('')
  })
})
