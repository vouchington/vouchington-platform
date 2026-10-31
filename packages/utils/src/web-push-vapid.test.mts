import { createPublicKey, verify } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  createVapidAuthorization,
  createVapidJwt,
  generateVapidKeys,
  isValidVapidSubject,
  vapidKeysMatch,
} from './web-push-vapid.mts'
import { decodeBase64Url, decodeVapidPublicKey, encodeBase64Url } from './web-push.mts'

describe('VAPID keys', () => {
  it('generates matching keys of the right shape', () => {
    const keys = generateVapidKeys()
    expect(decodeVapidPublicKey(keys.publicKey)).toHaveLength(65)
    expect(decodeBase64Url(keys.privateKey)).toHaveLength(32)
    expect(vapidKeysMatch(keys)).toBe(true)
  })

  it('detects mismatched and malformed keys', () => {
    const a = generateVapidKeys()
    const b = generateVapidKeys()
    expect(vapidKeysMatch({ publicKey: a.publicKey, privateKey: b.privateKey })).toBe(false)
    expect(vapidKeysMatch({ publicKey: 'nope', privateKey: a.privateKey })).toBe(false)
  })
})

describe('createVapidJwt', () => {
  const keys = generateVapidKeys()
  const input = {
    keys,
    audience: 'https://push.example.com',
    subject: 'mailto:ops@example.com',
    now: 1_000,
  }

  it('signs a verifiable ES256 token with claims', () => {
    const jwt = createVapidJwt({ ...input, expiresInSeconds: 60 })
    const [header, claims, signature] = jwt.split('.') as [string, string, string]
    const decode = (part: string) => JSON.parse(new TextDecoder().decode(decodeBase64Url(part)))
    expect(decode(header)).toEqual({ typ: 'JWT', alg: 'ES256' })
    expect(decode(claims)).toEqual({
      aud: 'https://push.example.com',
      exp: 1_060,
      sub: 'mailto:ops@example.com',
    })
    const point = decodeVapidPublicKey(keys.publicKey)
    const publicKey = createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: encodeBase64Url(point.slice(1, 33)),
        y: encodeBase64Url(point.slice(33)),
      },
      format: 'jwk',
    })
    expect(
      verify(
        'sha256',
        Buffer.from(`${header}.${claims}`),
        { key: publicKey, dsaEncoding: 'ieee-p1363' },
        Buffer.from(decodeBase64Url(signature)),
      ),
    ).toBe(true)
  })

  it('defaults the lifetime and clock', () => {
    const jwt = createVapidJwt({ keys, audience: input.audience, subject: 'https://example.com' })
    const claims = JSON.parse(new TextDecoder().decode(decodeBase64Url(jwt.split('.')[1]!)))
    expect(claims.exp).toBeGreaterThan(Math.floor(Date.now() / 1000))
  })

  it('rejects bad lifetimes and subjects', () => {
    expect(() => createVapidJwt({ ...input, expiresInSeconds: 0 })).toThrow(RangeError)
    expect(() => createVapidJwt({ ...input, expiresInSeconds: 86_401 })).toThrow(RangeError)
    for (const subject of [
      'http://x',
      'https://',
      'https:// bad',
      'mailto:',
      'mailto:nobody',
      'nope',
    ]) {
      expect(() => createVapidJwt({ ...input, subject })).toThrow(TypeError)
    }
    expect(isValidVapidSubject('mailto:ops@example.com')).toBe(true)
    expect(isValidVapidSubject('https://example.com/contact')).toBe(true)
  })

  it('builds the authorization header', () => {
    expect(createVapidAuthorization('jwt', keys.publicKey)).toBe(`vapid t=jwt, k=${keys.publicKey}`)
    expect(() => createVapidAuthorization('jwt', 'bad')).toThrow(TypeError)
    expect(createVapidAuthorization('jwt', `${keys.publicKey}=`)).toBe(
      `vapid t=jwt, k=${keys.publicKey}`,
    )
  })
})
