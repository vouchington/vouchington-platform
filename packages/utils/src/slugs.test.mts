import { describe, expect, it } from 'vitest'
import { isSlug, slugifyAscii } from './slugs.mts'

describe('ASCII slugification', () => {
  it('normalizes whitespace and separators', () => {
    expect(slugifyAscii('  Hello, World!  ')).toBe('hello-world')
    expect(slugifyAscii('a---b  c')).toBe('a-b-c')
    expect(slugifyAscii('日本語')).toBe('')
  })
})

describe('isSlug', () => {
  it('accepts lowercase letters, digits, and hyphens including edges slugifyAscii would strip', () => {
    expect(isSlug('hello-world')).toBe(true)
    expect(isSlug('my-post-123')).toBe(true)
    expect(isSlug('test')).toBe(true)
    expect(isSlug('123')).toBe(true)
    expect(isSlug('-x-')).toBe(true)
    expect(isSlug('a--b')).toBe(true)
    expect(isSlug('hello-')).toBe(true)
  })

  it('rejects empty, uppercase, underscore, and other punctuation', () => {
    expect(isSlug('')).toBe(false)
    expect(isSlug('Hello-World')).toBe(false)
    expect(isSlug('hello_world')).toBe(false)
    expect(isSlug('hello world')).toBe(false)
    expect(isSlug('hello@world')).toBe(false)
  })
})
