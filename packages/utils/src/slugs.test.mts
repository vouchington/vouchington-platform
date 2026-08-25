import { describe, expect, it } from 'vitest'
import { slugifyAscii } from './slugs.mts'

describe('ASCII slugification', () => {
  it('normalizes whitespace and separators', () => {
    expect(slugifyAscii('  Hello, World!  ')).toBe('hello-world')
    expect(slugifyAscii('a---b  c')).toBe('a-b-c')
    expect(slugifyAscii('日本語')).toBe('')
  })
})
