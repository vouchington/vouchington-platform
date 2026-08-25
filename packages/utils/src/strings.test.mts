import { describe, expect, it } from 'vitest'
import { normalizeKey, stripControlCharacters, toTitleCase } from './strings.mts'

describe('strings', () => {
  it('normalizes keys and title cases prose', () => {
    expect(normalizeKey(' Key ')).toBe('key')
    expect(toTitleCase('a tale of NASA and the sea')).toBe('A Tale of NASA and the Sea')
    expect(toTitleCase('')).toBe('')
  })
  it('preserves tab/newline/carriage return while stripping unsupported controls', () => {
    expect(stripControlCharacters('a\u0000b\tc\nd\re\u007f')).toBe('ab\tc\nd\re')
  })
})
