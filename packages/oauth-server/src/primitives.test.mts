import { describe, expect, it } from 'vitest'
import {
  MAX_REDIRECT_URIS,
  OAuthProtocolError,
  createPkceChallenge,
  generateOpaqueToken,
  invalidClient,
  matchesRegisteredRedirectUri,
  safeEqual,
  validatePkceChallenge,
  validatePkceVerifier,
  validateRedirectUris,
  verifyPkce,
} from './index.mts'

// RFC 7636 appendix B vector.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'

function code(fn: () => unknown): string {
  try {
    fn()
  } catch (err) {
    return (err as OAuthProtocolError).code
  }
  return 'none'
}

describe('errors and secrets', () => {
  it('defaults invalid_client to 401', () => {
    expect(invalidClient().status).toBe(401)
    expect(invalidClient('x').message).toBe('x')
    expect(invalidClient()).toBeInstanceOf(OAuthProtocolError)
  })

  it('generates prefixed random tokens and compares in constant time', () => {
    const a = generateOpaqueToken('p_')
    expect(a.startsWith('p_')).toBe(true)
    expect(generateOpaqueToken('p_')).not.toBe(a)
    expect(generateOpaqueToken('', 8)).toHaveLength(11)
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abd')).toBe(false)
    expect(safeEqual('abc', 'abcd')).toBe(false)
  })
})

describe('PKCE (RFC 7636)', () => {
  it('derives the RFC S256 challenge', () => {
    expect(createPkceChallenge(VERIFIER)).toBe(CHALLENGE)
    expect(verifyPkce(CHALLENGE, VERIFIER)).toBe(true)
    expect(verifyPkce(CHALLENGE, `${VERIFIER}x`)).toBe(false)
  })

  it('accepts only S256 with a well-formed challenge', () => {
    expect(validatePkceChallenge(CHALLENGE, 'S256')).toBe(CHALLENGE)
    expect(code(() => validatePkceChallenge(CHALLENGE, 'plain'))).toBe('invalid_request')
    expect(code(() => validatePkceChallenge(CHALLENGE, undefined))).toBe('invalid_request')
    expect(code(() => validatePkceChallenge('short', 'S256'))).toBe('invalid_request')
    expect(code(() => validatePkceChallenge(undefined, 'S256'))).toBe('invalid_request')
  })

  it('rejects malformed verifiers as invalid_grant', () => {
    expect(validatePkceVerifier(VERIFIER)).toBe(VERIFIER)
    expect(code(() => validatePkceVerifier('short'))).toBe('invalid_grant')
    expect(code(() => validatePkceVerifier(null))).toBe('invalid_grant')
    expect(code(() => validatePkceVerifier('a'.repeat(129)))).toBe('invalid_grant')
    expect(code(() => validatePkceVerifier(`${'a'.repeat(42)}!`))).toBe('invalid_grant')
  })
})

describe('redirect URIs', () => {
  it('serializes by default and keeps exact strings on request', () => {
    expect(validateRedirectUris(['https://Example.test'])).toEqual(['https://example.test/'])
    expect(validateRedirectUris(['https://Example.test'], { serialize: false })).toEqual([
      'https://Example.test',
    ])
    expect(
      validateRedirectUris([
        'http://localhost:3000/cb',
        'http://127.0.0.1/cb',
        'http://[::1]:8080/cb',
        'https://a.test/cb',
      ]),
    ).toHaveLength(4)
  })

  it.each([
    ['not an array', 'https://a.test'],
    ['empty', []],
    ['too many', Array.from({ length: MAX_REDIRECT_URIS + 1 }, (_, i) => `https://a.test/${i}`)],
    ['non-string', [1]],
    ['too long', [`https://a.test/${'a'.repeat(2048)}`]],
    ['whitespace', ['https://a.test/a b']],
    ['unparseable', ['notaurl']],
    ['wildcard', ['https://*.a.test/cb']],
    ['userinfo', ['https://user:pw@a.test/cb']],
    ['fragment', ['https://a.test/cb#x']],
    ['empty fragment', ['https://a.test/cb#']],
    ['custom scheme', ['myapp://cb']],
    ['plain http', ['http://a.test/cb']],
    ['duplicates', ['https://a.test', 'https://a.test/']],
    ['serialization grows', [`https://a.test/${'é'.repeat(1000)}`]],
  ])('rejects %s', (_name, value) => {
    expect(code(() => validateRedirectUris(value))).toBe('invalid_redirect_uri')
  })

  it('matches exactly, with RFC 8252 loopback port flexibility only', () => {
    const registered = ['https://app.test/cb', 'http://127.0.0.1/native?x=1', 'http://[::1]/native']
    expect(matchesRegisteredRedirectUri('https://app.test/cb', registered)).toBe(true)
    expect(matchesRegisteredRedirectUri('https://app.test/cb/', registered)).toBe(false)
    expect(matchesRegisteredRedirectUri('https://app.test:8443/cb', registered)).toBe(false)
    expect(matchesRegisteredRedirectUri('http://127.0.0.1:5123/native?x=1', registered)).toBe(true)
    expect(matchesRegisteredRedirectUri('http://[::1]:99/native', registered)).toBe(true)
    expect(matchesRegisteredRedirectUri('http://127.0.0.1:99999/native?x=1', registered)).toBe(
      false,
    )
    expect(matchesRegisteredRedirectUri('http://127.0.0.1:5123/other', registered)).toBe(false)
    expect(matchesRegisteredRedirectUri('http://localhost:5123/native', registered)).toBe(false)
    expect(matchesRegisteredRedirectUri('http://127.0.0.1:5123', ['http://127.0.0.1'])).toBe(true)
    expect(matchesRegisteredRedirectUri('http://127.0.0.1:5123', ['http://127.0.0.1/'])).toBe(true)
    expect(matchesRegisteredRedirectUri('http://[::1]:5123', ['http://[::1]/'])).toBe(true)
    expect(matchesRegisteredRedirectUri('http://127.0.0.1:5123', ['http://127.0.0.1/x'])).toBe(
      false,
    )
  })
})
