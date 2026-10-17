import { describe, expect, it } from 'vitest'
import { computeCrawlIntervalMs, robotsProductToken } from './index.mts'

describe('robotsProductToken', () => {
  it.each([
    ['ExampleBot/1.2 (+https://example.test)', 'ExampleBot'],
    ['  ExampleBot   extra', 'ExampleBot'],
    ['ExampleBot', 'ExampleBot'],
    ['/1.0', '*'],
    ['', '*'],
    ['   ', '*'],
  ])('maps %j to %s', (userAgent, token) => {
    expect(robotsProductToken(userAgent)).toBe(token)
  })
})

describe('computeCrawlIntervalMs', () => {
  it('defaults to one second with no inputs', () => {
    expect(computeCrawlIntervalMs()).toBe(1_000)
    expect(computeCrawlIntervalMs({ requestsPerSecond: 0 })).toBe(1_000)
    expect(computeCrawlIntervalMs({ requestsPerSecond: null, crawlDelayMs: null })).toBe(1_000)
  })

  it('derives the interval from requests per second', () => {
    expect(computeCrawlIntervalMs({ requestsPerSecond: 4 })).toBe(250)
    expect(computeCrawlIntervalMs({ requestsPerSecond: 3 })).toBe(334)
  })

  it('prefers the larger Crawl-delay and caps the result', () => {
    expect(computeCrawlIntervalMs({ requestsPerSecond: 4, crawlDelayMs: 5_000 })).toBe(5_000)
    expect(computeCrawlIntervalMs({ crawlDelayMs: 120_000 })).toBe(60_000)
  })

  it('honors caller defaults and maximum', () => {
    expect(computeCrawlIntervalMs({ defaultIntervalMs: 2_000, maxIntervalMs: 1_500 })).toBe(1_500)
    expect(computeCrawlIntervalMs({ defaultIntervalMs: 2_000 })).toBe(2_000)
  })
})
