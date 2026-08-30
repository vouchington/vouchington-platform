import { describe, expect, it } from 'vitest'
import {
  calculateWeightedAverage,
  formatBytes,
  formatCompactNumber,
  formatDuration,
  formatNumber,
  formatPercent,
  formatUtcDate,
  generateExcerpt,
} from './format.mts'

describe('formatting', () => {
  it('formats numbers and dates deterministically', () => {
    expect(formatNumber(1234, 'en-US')).toBe('1,234')
    expect(formatNumber(1234, 'en-US')).toBe('1,234')
    expect(formatNumber(1234, ['en-US'])).toBe('1,234')
    expect(formatCompactNumber(1_200, 'en-US')).toBe('1.2K')
    expect(formatCompactNumber(1_200, 'en-US')).toBe('1.2K')
    expect(formatCompactNumber(1_200_000_000, 'en-US')).toBe('1.2B')
    expect(formatUtcDate('2026-02-03T23:00:00-08:00', 'en-US')).toBe('Feb 4, 2026')
    expect(formatUtcDate('2026-02-03T23:00:00-08:00', 'en-US')).toBe('Feb 4, 2026')
    expect(formatPercent(0.951)).toBe('95.1%')
    expect(formatBytes(1)).toBe('1 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1024 ** 2)).toBe('1.0 MB')
    expect(formatBytes(1024 ** 3)).toBe('1.00 GB')
    expect(formatDuration(65)).toBe('01:05')
    expect(formatDuration(3661)).toBe('1:01:01')
  })

  it('creates a bounded plain-text excerpt', () => {
    expect(generateExcerpt('## **Hello** [world](https://example.test)', 30)).toBe('Hello world')
    expect(generateExcerpt('one two three four', 9)).toBe('one two...')
    expect(generateExcerpt('abcdefghij', 5)).toBe('abcde...')
  })

  it('calculates a weighted average without owning a rating scale', () => {
    expect(calculateWeightedAverage({ 1: 0, 3: 1, 5: 2 })).toBe(13 / 3)
    expect(calculateWeightedAverage({ 1: 0, 5: 0 })).toBeNull()
  })
})
