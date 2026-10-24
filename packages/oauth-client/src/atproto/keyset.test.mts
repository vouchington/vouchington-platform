import { describe, expect, it } from 'vitest'
import { parseEcKeyset } from './keyset.mts'
import { makeJwk, toEnv } from './test-helpers.mts'

const kids = (keyset: Awaited<ReturnType<typeof parseEcKeyset>>) =>
  keyset.publicJwks.keys.map((key) => key.kid).toSorted()

describe('parseEcKeyset', () => {
  it('loads a single key and publishes only the public half', async () => {
    const keyset = await parseEcKeyset({
      env: toEnv([makeJwk('single-key')]),
      mode: 'production',
    })
    expect(keyset.size).toBe(1)
    const [key] = keyset.publicJwks.keys
    expect(key?.kid).toBe('single-key')
    expect(JSON.parse(JSON.stringify(key))).not.toHaveProperty('d')
  })

  it('accepts a multi-key array, a { keys } document, and a bare JWK', async () => {
    const many = await parseEcKeyset({
      env: toEnv([makeJwk('k-1'), makeJwk('k-2')]),
      mode: 'production',
    })
    expect(kids(many)).toEqual(['k-1', 'k-2'])
    const wrapped = await parseEcKeyset({
      env: toEnv({ keys: [makeJwk('wrapped')] }),
      mode: 'test',
    })
    expect(kids(wrapped)).toEqual(['wrapped'])
    const bare = await parseEcKeyset({ env: toEnv(makeJwk('bare')), mode: 'test' })
    expect(kids(bare)).toEqual(['bare'])
  })

  describe('fallback key', () => {
    it('uses the injected fallback outside production when unconfigured', async () => {
      for (const mode of ['development', 'test'] as const) {
        const keyset = await parseEcKeyset({ env: '', mode, fallbackKey: makeJwk('fallback') })
        expect(kids(keyset)).toEqual(['fallback'])
      }
    })

    it('validates the fallback like any configured key', async () => {
      await expect(
        parseEcKeyset({
          env: '',
          mode: 'test',
          fallbackKey: { ...makeJwk('f-bad'), crv: 'P-384' },
        }),
      ).rejects.toThrow('fallbackKey[0] must be an EC P-256 JWK')
    })

    it('never uses the fallback in production', async () => {
      await expect(
        parseEcKeyset({ env: '', mode: 'production', fallbackKey: makeJwk('prod-fallback') }),
      ).rejects.toThrow('ATPROTO_PRIVATE_KEYS_B64 must be configured in production')
    })

    it('requires configuration outside production when no fallback is injected', async () => {
      await expect(
        parseEcKeyset({ env: '', mode: 'development', envName: 'MY_KEYS' }),
      ).rejects.toThrow('MY_KEYS must be configured')
    })
  })

  describe('rejections', () => {
    const reject = (env: string, message: string | RegExp) =>
      expect(parseEcKeyset({ env, mode: 'production', envName: 'KEYS' })).rejects.toThrow(message)

    it('rejects invalid base64 JSON', () =>
      reject('not-valid-base64-json!!!', 'KEYS must be valid base64-encoded JSON'))

    it('rejects an empty list and non-object entries', async () => {
      await reject(toEnv([]), 'KEYS must contain at least one JWK')
      await reject(toEnv(['string']), 'KEYS[0] must be a JSON object')
      await reject(toEnv(null), 'KEYS[0] must be a JSON object')
    })

    it('rejects a wrong curve, key type, or algorithm', async () => {
      await reject(toEnv([{ ...makeJwk('a'), kty: 'RSA' }]), 'KEYS[0] must be an EC P-256 JWK')
      await reject(toEnv([{ ...makeJwk('a'), crv: 'P-384' }]), 'KEYS[0] must be an EC P-256 JWK')
      await reject(toEnv([{ ...makeJwk('a'), alg: 'ES384' }]), 'KEYS[0] must use ES256')
    })

    it('accepts a key without an alg', async () => {
      const { alg: _alg, ...jwk } = makeJwk('no-alg')
      await expect(
        parseEcKeyset({ env: toEnv([jwk]), mode: 'production', envName: 'KEYS' }),
      ).resolves.toHaveProperty('size', 1)
    })

    it('rejects public-only keys and missing or empty kids', async () => {
      const { d: _d, ...publicOnly } = makeJwk('public')
      await reject(toEnv([publicOnly]), 'KEYS[0] must be a private key (missing d)')
      await reject(toEnv([{ ...makeJwk('a'), d: '' }]), 'missing d')
      const { kid: _kid, ...noKid } = makeJwk('x')
      await reject(toEnv([noKid]), 'KEYS[0] is missing kid')
      await reject(toEnv([{ ...makeJwk('a'), kid: '' }]), 'KEYS[0] is missing kid')
    })

    it('rejects duplicate kids', () =>
      reject(toEnv([makeJwk('dupe'), makeJwk('dupe')]), 'KEYS contains duplicate kid values: dupe'))
  })

  it('memoizes per mode, env name, env value, and fallback key', async () => {
    const env = toEnv([makeJwk('memo')])
    const first = parseEcKeyset({ env, mode: 'production' })
    expect(parseEcKeyset({ env, mode: 'production' })).toBe(first)
    expect(parseEcKeyset({ env, mode: 'test' })).not.toBe(first)
    expect(parseEcKeyset({ env, mode: 'production', envName: 'OTHER' })).not.toBe(first)
    const fallback = makeJwk('memo-fallback')
    expect(parseEcKeyset({ env: '', mode: 'test', fallbackKey: fallback })).toBe(
      parseEcKeyset({ env: '', mode: 'test', fallbackKey: fallback }),
    )
  })
})
