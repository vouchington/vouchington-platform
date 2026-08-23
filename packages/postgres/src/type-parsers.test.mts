import { describe, expect, it, vi } from 'vitest'

import { ignoreMissingVectorType } from './vector.mts'
import { installPgTypeParsers, resetPgTypeParsersForTest } from './type-parsers.mts'

describe('type parsers and vector helpers', () => {
  it('installs parsers only once', () => {
    resetPgTypeParsersForTest()
    installPgTypeParsers()
    installPgTypeParsers()
    resetPgTypeParsersForTest()
    installPgTypeParsers()
  })

  it('ignores missing vector types and reports other errors', () => {
    const handler = vi.fn()
    ignoreMissingVectorType(new Error('vector type not found in the database'), handler)
    expect(handler).not.toHaveBeenCalled()
    const other = new Error('boom')
    ignoreMissingVectorType(other, handler)
    expect(handler).toHaveBeenCalledWith(other)
  })
})
