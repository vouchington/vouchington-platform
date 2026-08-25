import { describe, expect, it } from 'vitest'
import { countSentences, countWords } from './text-metrics.mts'

describe('text metrics', () => {
  it('counts words and sentence-ending punctuation', () => {
    expect(countWords('  one\n two  ')).toBe(2)
    expect(countWords('')).toBe(0)
    expect(countSentences('One. Two! "Three?"')).toBe(3)
    expect(countSentences('   ')).toBe(0)
  })
})
