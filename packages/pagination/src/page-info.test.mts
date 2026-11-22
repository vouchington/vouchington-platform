import { describe, expect, it } from 'vitest'
import { sliceRawKeysetPage } from './page-info.mts'

describe('sliceRawKeysetPage', () => {
  it('drops the probe row and reports more', () => {
    expect(sliceRawKeysetPage([1, 2, 3], 2)).toEqual({ window: [1, 2], hasMore: true })
  })

  it('reports no more when rows fit the limit', () => {
    expect(sliceRawKeysetPage([1, 2], 2)).toEqual({ window: [1, 2], hasMore: false })
    expect(sliceRawKeysetPage([], 2)).toEqual({ window: [], hasMore: false })
  })
})
