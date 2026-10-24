import { describe, expect, it } from 'vitest'
import { generateCodeChallenge, generateCodeVerifier, generateState } from './oauth-pkce.mts'

describe('oauth-pkce', () => {
  it('creates a 43 character URL-safe verifier without padding', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateCodeVerifier()).toMatch(/^[A-Za-z0-9_-]{43}$/)
    }
    expect(generateCodeVerifier()).not.toBe(generateCodeVerifier())
  })

  it('creates unique 32 character hex state values', () => {
    const a = generateState()
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(generateState()).not.toBe(a)
  })

  it('matches the RFC 7636 S256 test vector', async () => {
    await expect(
      generateCodeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
    ).resolves.toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })
})
