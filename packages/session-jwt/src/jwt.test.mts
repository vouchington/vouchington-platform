import * as jose from 'jose'
import { describe, expect, it } from 'vitest'
import { createJwtKeySet } from './keys.mts'
import { decodeJwt, signJwt, verifyJwt } from './jwt.mts'

async function makeKeySet() {
  const { privateKey } = await jose.generateKeyPair('RS512', { extractable: true })
  return createJwtKeySet({
    privateJwks: [{ ...(await jose.exportJWK(privateKey)), alg: 'RS512', kid: 'current' }],
  })
}

describe('generic JWTs', () => {
  it('signs, verifies, and decodes caller-owned claims', async () => {
    const keySet = await makeKeySet()
    const token = await signJwt(
      { subject: 'person-1', scope: ['read'] },
      { keySet, issuer: 'issuer', audience: 'client', expiresIn: '1h' },
    )
    await expect(
      verifyJwt(token, { keySet, issuer: 'issuer', audience: 'client' }),
    ).resolves.toMatchObject({
      subject: 'person-1',
      scope: ['read'],
    })
    expect(decodeJwt(token)).toMatchObject({ subject: 'person-1', scope: ['read'] })
  })

  it('accepts caller-supplied audience lists without Node Buffer APIs', async () => {
    const keySet = await makeKeySet()
    const originalBuffer = globalThis.Buffer
    Object.defineProperty(globalThis, 'Buffer', { configurable: true, value: undefined })
    try {
      const token = await signJwt(
        { ok: true },
        { keySet, issuer: 'issuer', audience: ['one', 'two'], expiresIn: '1h' },
      )
      await expect(
        verifyJwt(token, { keySet, issuer: 'issuer', audience: ['two'] }),
      ).resolves.toMatchObject({ ok: true })
    } finally {
      Object.defineProperty(globalThis, 'Buffer', { configurable: true, value: originalBuffer })
    }
  })

  it('uses the first private key for signing and all public keys for verification', async () => {
    const { privateKey: oldPrivate } = await jose.generateKeyPair('RS512', { extractable: true })
    const { privateKey: currentPrivate } = await jose.generateKeyPair('RS512', {
      extractable: true,
    })
    const old = { ...(await jose.exportJWK(oldPrivate)), alg: 'RS512', kid: 'old' }
    const current = { ...(await jose.exportJWK(currentPrivate)), alg: 'RS512', kid: 'current' }
    const keySet = await createJwtKeySet({ privateJwks: [current, old] })
    const oldToken = await new jose.SignJWT({ scope: ['old'] })
      .setProtectedHeader({ alg: 'RS512', kid: 'old' })
      .setIssuer('issuer')
      .setAudience('client')
      .setExpirationTime('1h')
      .sign(await jose.importJWK(old, 'RS512'))
    expect(
      jose.decodeProtectedHeader(
        await signJwt({}, { keySet, issuer: 'issuer', audience: 'client', expiresIn: '1h' }),
      ).kid,
    ).toBe('current')
    await expect(
      verifyJwt(oldToken, { keySet, issuer: 'issuer', audience: 'client' }),
    ).resolves.toMatchObject({
      scope: ['old'],
    })
  })

  it('returns null for malformed, wrong issuer, wrong audience, and invalid payloads', async () => {
    const keySet = await makeKeySet()
    const token = await signJwt(
      { ok: true },
      { keySet, issuer: 'issuer', audience: 'client', expiresIn: '1h' },
    )
    await expect(
      verifyJwt(token, { keySet, issuer: 'other', audience: 'client' }),
    ).resolves.toBeNull()
    await expect(
      verifyJwt(token, { keySet, issuer: 'issuer', audience: 'other' }),
    ).resolves.toBeNull()
    await expect(
      verifyJwt(token, {
        keySet,
        issuer: 'issuer',
        audience: 'client',
        validatePayload: (_payload): _payload is jose.JWTPayload => false,
      }),
    ).resolves.toBeNull()
    await expect(
      verifyJwt('not.a.jwt', { keySet, issuer: 'issuer', audience: 'client' }),
    ).resolves.toBeNull()
    expect(decodeJwt('not.a.jwt')).toBeNull()
  })

  it('returns null when no configured public key matches the token header', async () => {
    const keySet = await makeKeySet()
    const token = await new jose.SignJWT({ ok: true })
      .setProtectedHeader({ alg: 'RS512', kid: 'missing' })
      .setIssuer('issuer')
      .setAudience('client')
      .setExpirationTime('1h')
      .sign(keySet.privateKeys[0]!.cryptoKey)
    await expect(
      verifyJwt(token, { keySet, issuer: 'issuer', audience: 'client' }),
    ).resolves.toBeNull()
    await expect(
      signJwt(
        {},
        {
          keySet: await createJwtKeySet({ publicJwks: [keySet.publicKeys[0]!.jwk] }),
          issuer: 'issuer',
          audience: 'client',
          expiresIn: '1h',
        },
      ),
    ).rejects.toThrow('private')
  })

  it('tries every public key when a valid token has no key identifier', async () => {
    const keySet = await makeKeySet()
    const token = await new jose.SignJWT({ unlabelled: true })
      .setProtectedHeader({ alg: 'RS512' })
      .setIssuer('issuer')
      .setAudience('client')
      .setExpirationTime('1h')
      .sign(keySet.privateKeys[0]!.cryptoKey)
    await expect(
      verifyJwt(token, { keySet, issuer: 'issuer', audience: 'client' }),
    ).resolves.toMatchObject({
      unlabelled: true,
    })
  })

  it('rejects expired and tampered tokens', async () => {
    const keySet = await makeKeySet()
    const expiredAt = Math.floor(Date.now() / 1000) - 30
    const expired = await signJwt(
      { ok: true },
      { keySet, issuer: 'issuer', audience: 'client', expiresIn: expiredAt },
    )
    await expect(
      verifyJwt(expired, { keySet, issuer: 'issuer', audience: 'client' }),
    ).resolves.toBeNull()
    await expect(
      verifyJwt(expired, {
        keySet,
        issuer: 'issuer',
        audience: 'client',
        clockTolerance: 60,
      }),
    ).resolves.toMatchObject({ ok: true })

    const valid = await signJwt(
      { ok: true },
      { keySet, issuer: 'issuer', audience: 'client', expiresIn: '1h' },
    )
    const [header, payload, signature] = valid.split('.') as [string, string, string]
    const tampered = `${header}.${payload}.${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`
    await expect(
      verifyJwt(tampered, { keySet, issuer: 'issuer', audience: 'client' }),
    ).resolves.toBeNull()
  })

  it('throws for invalid signing and verification configuration', async () => {
    const keySet = await makeKeySet()
    const base = { keySet, issuer: 'issuer', audience: 'client' } as const
    await expect(signJwt({}, { ...base, issuer: ' ', expiresIn: '1h' })).rejects.toThrow('issuer')
    await expect(signJwt({}, { ...base, audience: [], expiresIn: '1h' })).rejects.toThrow(
      'audience',
    )
    await expect(signJwt({}, { ...base, audience: [''], expiresIn: '1h' })).rejects.toThrow(
      'audience',
    )
    await expect(signJwt({}, { ...base, expiresIn: '' })).rejects.toThrow('expiration')
    await expect(signJwt({}, { ...base, expiresIn: Number.NaN })).rejects.toThrow('expiration')
    await expect(signJwt({}, { ...base, expiresIn: new Date(Number.NaN) })).rejects.toThrow(
      'expiration',
    )
    await expect(signJwt({}, { ...base, expiresIn: {} as unknown as string })).rejects.toThrow(
      'expiration',
    )
    await expect(signJwt({}, { ...base, expiresIn: '1h', issuedAt: Number.NaN })).rejects.toThrow(
      'issued-at',
    )
    await expect(verifyJwt('not.a.jwt', { ...base, issuer: '' })).rejects.toThrow('issuer')
    await expect(verifyJwt('not.a.jwt', { ...base, audience: [] })).rejects.toThrow('audience')
    await expect(
      verifyJwt('not.a.jwt', { ...base, audience: 1 as unknown as string }),
    ).rejects.toThrow('audience')
    await expect(verifyJwt('not.a.jwt', { ...base, clockTolerance: -1 })).rejects.toThrow(
      'clock tolerance',
    )
    await expect(verifyJwt('not.a.jwt', { ...base, clockTolerance: Number.NaN })).rejects.toThrow(
      'clock tolerance',
    )
  })
})
