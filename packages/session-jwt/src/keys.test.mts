import * as jose from 'jose'
import { describe, expect, it } from 'vitest'
import {
  createJwtKeySet,
  derivePublicJwk,
  JwtKeySetCache,
  parseJwkSet,
  type JwtKeySetOptions,
} from './keys.mts'

async function makePrivateJwk(kid: string, keyOperations?: string[]): Promise<jose.JWK> {
  const { privateKey } = await jose.generateKeyPair('RS512', { extractable: true })
  return {
    ...(await jose.exportJWK(privateKey)),
    alg: 'RS512',
    kid,
    use: 'sig',
    ...(keyOperations === undefined ? {} : { key_ops: keyOperations }),
  }
}

describe('JWT key sets', () => {
  it('imports private keys and derives usable public keys', async () => {
    const privateJwk = await makePrivateJwk('current', ['sign'])
    const keySet = await createJwtKeySet({ privateJwks: [privateJwk] })
    expect(keySet.privateKeys).toHaveLength(1)
    expect(keySet.publicKeys).toHaveLength(1)
    expect(keySet.publicKeys[0]!.jwk.key_ops).toEqual(['verify'])
    expect(derivePublicJwk(privateJwk)).not.toHaveProperty('d')
    expect(keySet.privateKeys[0]!.cryptoKey.type).toBe('private')
    expect(keySet.publicKeys[0]!.cryptoKey.type).toBe('public')
  })

  it('defensively snapshots and freezes key metadata', async () => {
    const privateJwk = await makePrivateJwk('before')
    const keySet = await createJwtKeySet({ privateJwks: [privateJwk] })
    privateJwk.kid = 'after'
    expect(keySet.privateKeys[0]!.jwk.kid).toBe('before')
    expect(Object.isFrozen(keySet)).toBe(true)
    expect(Object.isFrozen(keySet.privateKeys)).toBe(true)
    expect(Object.isFrozen(keySet.privateKeys[0]!.jwk)).toBe(true)
  })

  it('offers explicit, identity-based, lifecycle-owned caching', async () => {
    const options: JwtKeySetOptions = { privateJwks: [await makePrivateJwk('current')] }
    const cache = new JwtKeySetCache()
    const firstPromise = cache.getOrCreate(options)
    expect(cache.getOrCreate(options)).toBe(firstPromise)
    const first = await firstPromise
    expect(first.publicKeys[0]!.jwk.kid).toBe('current')
    expect(cache.delete(options)).toBe(true)
    expect(await cache.getOrCreate(options)).not.toBe(first)
    cache.clear()
    expect(await cache.getOrCreate(options)).not.toBe(first)
  })

  it('does not retain failed cache entries', async () => {
    const options = { privateJwks: [derivePublicJwk(await makePrivateJwk('public'))] }
    const cache = new JwtKeySetCache()
    const failed = cache.getOrCreate(options)
    await expect(failed).rejects.toThrow('private key material')
    await expect(cache.getOrCreate(options)).rejects.toThrow('private key material')
    const deletedFailure = cache.getOrCreate(options)
    cache.delete(options)
    await expect(deletedFailure).rejects.toThrow('private key material')
  })

  it('parses JWK arrays or sets and rejects malformed key metadata', async () => {
    const publicJwk = derivePublicJwk(await makePrivateJwk('one'))
    expect(parseJwkSet([publicJwk], 'keys')).toHaveLength(1)
    expect(parseJwkSet({ keys: [publicJwk] }, 'keys')).toHaveLength(1)
    const [withCertificate] = parseJwkSet([{ ...publicJwk, x5c: ['certificate'] }], 'keys')
    expect(Object.isFrozen(withCertificate!.x5c)).toBe(true)
    expect(() => parseJwkSet([], 'keys')).toThrow('at least one')
    expect(() => parseJwkSet(null, 'keys')).toThrow('JWK')
    expect(() => parseJwkSet([{ ...publicJwk, kty: 'EC' }], 'keys')).toThrow('RSA')
    expect(() => parseJwkSet([{ ...publicJwk, alg: 'RS256' }], 'keys')).toThrow('RS512')
    expect(() => parseJwkSet([{ ...publicJwk, kid: ' ' }], 'keys')).toThrow('kid')
    expect(() => parseJwkSet([{ ...publicJwk, use: 'enc' }], 'keys')).toThrow('signature')
    expect(() =>
      parseJwkSet([{ ...publicJwk, key_ops: 'verify' as unknown as string[] }], 'keys'),
    ).toThrow('key_ops')
    expect(() => parseJwkSet([{ ...publicJwk, n: undefined }], 'keys')).toThrow('modulus')
    expect(() => parseJwkSet([{ ...publicJwk, n: '+' }], 'keys')).toThrow('invalid RSA modulus')
    expect(() =>
      parseJwkSet(
        [{ ...publicJwk, n: jose.base64url.encode(new Uint8Array(128).fill(1)) }],
        'keys',
      ),
    ).toThrow('at least 2048 bits')
    expect(() =>
      parseJwkSet([{ ...publicJwk, n: jose.base64url.encode(new Uint8Array(256)) }], 'keys'),
    ).toThrow('at least 2048 bits')
    const undersizedModulus = new Uint8Array(256).fill(1)
    expect(() =>
      parseJwkSet([{ ...publicJwk, n: jose.base64url.encode(undersizedModulus) }], 'keys'),
    ).toThrow('at least 2048 bits')
    expect(() => parseJwkSet([publicJwk, publicJwk], 'keys')).toThrow('duplicate')
    await expect(createJwtKeySet({})).rejects.toThrow('private or public')
  })

  it('rejects role mismatches, incompatible operations, and failed imports', async () => {
    const privateJwk = await makePrivateJwk('private')
    const publicJwk = derivePublicJwk(privateJwk)
    await expect(createJwtKeySet({ privateJwks: [publicJwk] })).rejects.toThrow(
      'private key material',
    )
    await expect(createJwtKeySet({ publicJwks: [privateJwk] })).rejects.toThrow('must not contain')
    await expect(
      createJwtKeySet({ privateJwks: [{ ...privateJwk, key_ops: ['verify'] }] }),
    ).rejects.toThrow('only sign')
    await expect(
      createJwtKeySet({ publicJwks: [{ ...publicJwk, key_ops: ['sign'] }] }),
    ).rejects.toThrow('only verify')
    const incompletePrivateJwk = { ...privateJwk }
    delete incompletePrivateJwk.p
    await expect(createJwtKeySet({ privateJwks: [incompletePrivateJwk] })).rejects.toThrow(
      'complete RSA private',
    )
    expect(() => parseJwkSet([{ ...publicJwk, e: 'AA' }], 'keys')).toThrow('exponent 65537')
    await expect(
      createJwtKeySet({
        privateJwks: [{ ...privateJwk, oth: [{ d: 'AA', r: 'AA', t: 'AA' }] }],
      }),
    ).rejects.toThrow('Failed to import privateJwks')
  })

  it('accepts an explicitly public-only key set', async () => {
    const publicJwk = derivePublicJwk(await makePrivateJwk('verify', ['sign']))
    const keySet = await createJwtKeySet({ publicJwks: [publicJwk] })
    expect(keySet.privateKeys).toEqual([])
    expect(keySet.publicKeys[0]!.jwk.key_ops).toEqual(['verify'])
  })
})
