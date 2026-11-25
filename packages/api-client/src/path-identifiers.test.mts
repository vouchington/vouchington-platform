import { describe, expect, it } from 'vitest'
import { assertEncodablePathSegmentIdentifier, assertPathIdentifier } from './path-identifiers.mts'

describe('assertPathIdentifier', () => {
  it('accepts normal identifiers', () => {
    expect(assertPathIdentifier('item-123')).toBe('item-123')
  })

  it('rejects dot segments and path separators', () => {
    expect(() => assertPathIdentifier('.')).toThrow('Invalid identifier')
    expect(() => assertPathIdentifier('..')).toThrow('Invalid identifier')
    expect(() => assertPathIdentifier('a/b')).toThrow('Invalid identifier')
    expect(() => assertPathIdentifier(String.raw`a\b`)).toThrow('Invalid identifier')
  })
})

describe('assertEncodablePathSegmentIdentifier', () => {
  it('accepts slash-bearing identifiers meant for encodeURIComponent', () => {
    const identifier = 'feed-id:https://example.test/item/1'
    expect(assertEncodablePathSegmentIdentifier(identifier)).toBe(identifier)
    expect(encodeURIComponent(identifier)).toBe('feed-id%3Ahttps%3A%2F%2Fexample.test%2Fitem%2F1')
  })

  it('rejects dot segments and backslashes', () => {
    expect(() => assertEncodablePathSegmentIdentifier('.')).toThrow('Invalid identifier')
    expect(() => assertEncodablePathSegmentIdentifier('..')).toThrow('Invalid identifier')
    expect(() => assertEncodablePathSegmentIdentifier(String.raw`a\b`)).toThrow(
      'Invalid identifier',
    )
  })
})
