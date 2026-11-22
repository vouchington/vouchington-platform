import { describe, expect, it } from 'vitest'
import { createBotTierClassifier, isVerifiedBotRequest } from './bot-tier.mts'

const classify = createBotTierClassifier({
  isBot: (ua) => /bot/i.test(ua),
  knownUserAgentSubstrings: ['GoodBot', 'Other-Spider'],
  knownTier: 'known',
  unknownTier: 'unknown',
})

describe('createBotTierClassifier', () => {
  it('returns null for missing or human user agents', () => {
    expect(classify(null, { verifiedBot: true })).toBeNull()
    expect(classify('', { verifiedBot: true })).toBeNull()
    expect(classify('Mozilla/5.0')).toBeNull()
  })

  it('returns known only for a verified bot matching a substring case-insensitively', () => {
    expect(classify('goodbot/1.0', { verifiedBot: true })).toBe('known')
  })

  it('treats spoofed known user agents as unknown', () => {
    expect(classify('GoodBot/1.0')).toBe('unknown')
    expect(classify('GoodBot/1.0', { verifiedBot: false })).toBe('unknown')
  })

  it('treats unmatched bots as unknown even when verified', () => {
    expect(classify('randombot/1.0', { verifiedBot: true })).toBe('unknown')
  })
})

describe('isVerifiedBotRequest', () => {
  const withCf = (cf: unknown) => Object.assign(new Request('https://example.com'), { cf })

  it('reads the verified flag', () => {
    expect(isVerifiedBotRequest(withCf({ botManagement: { verifiedBot: true } }))).toBe(true)
    expect(isVerifiedBotRequest(withCf({ botManagement: { verifiedBot: false } }))).toBe(false)
    expect(isVerifiedBotRequest(withCf({}))).toBe(false)
    expect(isVerifiedBotRequest(new Request('https://example.com'))).toBe(false)
  })
})
