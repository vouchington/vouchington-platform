import * as jose from 'jose'
import { describe, expect, it } from 'vitest'
import { encodeJwkSet, parseBase64JwkSet } from './jwk-set-codec.mts'

async function makeJwk(kid: string): Promise<jose.JWK> {
  const { publicKey } = await jose.generateKeyPair('RS512', { extractable: true })
  return { ...(await jose.exportJWK(publicKey)), alg: 'RS512', kid, use: 'sig' }
}

describe('JWK set codec', () => {
  it('parses arrays, JWKS objects, and single JWKs', async () => {
    const jwk = await makeJwk('a')
    for (const value of [[jwk], { keys: [jwk] }, jwk]) {
      const encoded = btoa(JSON.stringify(value))
      expect(parseBase64JwkSet(encoded, 'KEYS').map((key) => key.kid)).toEqual(['a'])
    }
  })

  it('round-trips UTF-8 metadata', async () => {
    const jwk = await makeJwk('é-ключ')
    expect(parseBase64JwkSet(encodeJwkSet([jwk]), 'KEYS')[0]!.kid).toBe('é-ключ')
  })

  it('names the source for malformed input', () => {
    expect(() => parseBase64JwkSet('***', 'KEYS')).toThrow(/KEYS must be valid base64-encoded JSON/)
    expect(() => parseBase64JwkSet(btoa('nope'), 'KEYS')).toThrow(/KEYS must be valid/)
    expect(() => parseBase64JwkSet(btoa('\xff'), 'KEYS')).toThrow(/KEYS must be valid/)
    expect(() => parseBase64JwkSet(btoa('[]'), 'KEYS')).toThrow(
      'KEYS must contain at least one JWK',
    )
  })

  it('reports non-Error failures generically', () => {
    const original = globalThis.atob
    globalThis.atob = () => {
      throw 'boom'
    }
    try {
      expect(() => parseBase64JwkSet('x', 'KEYS')).toThrow(
        'KEYS must be valid base64-encoded JSON: unknown error',
      )
    } finally {
      globalThis.atob = original
    }
  })
})
