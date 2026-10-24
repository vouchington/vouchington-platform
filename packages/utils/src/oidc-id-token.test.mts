import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createOidcIdTokenVerifier, OidcVerificationError } from './oidc-id-token.mts'
import {
  NOW_MS,
  NOW_S,
  jsonResponse,
  makeKey,
  signToken,
  validClaims,
} from './oidc-id-token-test-helpers.mts'

const key = makeKey('k1')

function setup(overrides: Record<string, unknown> = {}, keys = [key.jwk]) {
  let now = NOW_MS
  const fetch = vi.fn(async () => jsonResponse({ keys }))
  const verifier = createOidcIdTokenVerifier({
    jwksUri: 'https://issuer.example.com/jwks',
    issuers: ['https://issuer.example.com', 'issuer.example.com'],
    audiences: () => ['client-1', 'client-2'],
    fetch,
    now: () => now,
    ...overrides,
  })
  return { verifier, fetch, advance: (ms: number) => (now += ms) }
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(OidcVerificationError)
  return (error as OidcVerificationError).code
}

describe('createOidcIdTokenVerifier', () => {
  it('returns claims for a valid token without forwarding the caller signal to the shared fetch', async () => {
    const { verifier, fetch } = setup()
    const signal = new AbortController().signal
    const claims = await verifier.verify(signToken(key, validClaims()), { signal })
    expect(claims.sub).toBe('user-1')
    expect(fetch).toHaveBeenCalledWith('https://issuer.example.com/jwks')
  })

  it('rejects a missing, empty, or non-string sub', async () => {
    const { verifier } = setup()
    for (const sub of [undefined, null, '', 42, { id: 'x' }]) {
      expect(await codeOf(verifier.verify(signToken(key, validClaims({ sub }))))).toBe('format')
    }
  })

  it('accepts array audiences', async () => {
    const { verifier, fetch } = setup()
    await verifier.verify(signToken(key, validClaims({ aud: ['x', 'client-2'] })))
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('uses Date.now and the default skew when not injected', async () => {
    const fetch = vi.fn(async () => jsonResponse({ keys: [key.jwk] }))
    const verifier = createOidcIdTokenVerifier({
      jwksUri: 'https://issuer.example.com/jwks',
      issuers: ['https://issuer.example.com'],
      audiences: () => ['client-1'],
      fetch,
    })
    const nowS = Math.floor(Date.now() / 1000)
    await expect(
      verifier.verify(signToken(key, validClaims({ iat: nowS, exp: nowS + 60 }))),
    ).resolves.toMatchObject({ sub: 'user-1' })
  })

  it.each([
    ['empty', ''],
    ['two parts', 'a.b'],
    ['four parts', 'a.b.c.d'],
    ['non-JSON header', 'bm90LWpzb24.e30.c2ln'],
    ['array header', `${Buffer.from('[]').toString('base64url')}.e30.c2ln`],
  ])('rejects a malformed token: %s', async (_name, token) => {
    expect(await codeOf(setup().verifier.verify(token))).toBe('format')
  })

  it('rejects algorithms other than RS256', async () => {
    const token = signToken(key, validClaims(), { alg: 'HS256' })
    expect(await codeOf(setup().verifier.verify(token))).toBe('alg')
  })

  it('rejects a bad signature and an unusable key', async () => {
    const other = makeKey('k1')
    expect(await codeOf(setup().verifier.verify(signToken(other, validClaims())))).toBe('signature')
    const broken = setup({}, [{ ...key.jwk, n: '!' }])
    expect(await codeOf(broken.verifier.verify(signToken(key, validClaims())))).toBe('signature')
  })

  it('rejects expired, future, wrong issuer, and wrong audience tokens', async () => {
    const { verifier } = setup()
    const check = (claims: Record<string, unknown>) =>
      codeOf(verifier.verify(signToken(key, validClaims(claims))))
    expect(await check({ exp: NOW_S - 1 })).toBe('expired')
    expect(await check({ iat: NOW_S + 301 })).toBe('future_iat')
    expect(await check({ iss: 'https://evil.example.com' })).toBe('issuer')
    expect(await check({ aud: 'other' })).toBe('audience')
    expect(await check({ exp: undefined })).toBe('format')
    expect(await check({ iat: 'now' })).toBe('format')
    await expect(
      verifier.verify(signToken(key, validClaims({ iat: NOW_S + 300 }))),
    ).resolves.toBeTruthy()
  })

  it('rejects when no audiences are configured', async () => {
    const { verifier } = setup({ audiences: () => [] })
    expect(await codeOf(verifier.verify(signToken(key, validClaims())))).toBe('audience')
  })

  it('honors custom skew', async () => {
    const { verifier } = setup({ maxIatSkewSeconds: 0 })
    expect(await codeOf(verifier.verify(signToken(key, validClaims({ iat: NOW_S + 1 }))))).toBe(
      'future_iat',
    )
  })

  describe('nonce', () => {
    const hash = (value: string) => createHash('sha256').update(value).digest('hex')

    it('matches a hashed or raw nonce', async () => {
      const { verifier } = setup()
      await expect(
        verifier.verify(signToken(key, validClaims({ nonce: hash('n') })), {
          nonce: 'n',
          nonceHash: 'sha256-hex',
        }),
      ).resolves.toBeTruthy()
      await expect(
        verifier.verify(signToken(key, validClaims({ nonce: 'raw' })), { nonce: 'raw' }),
      ).resolves.toBeTruthy()
    })

    it('rejects a mismatched or missing nonce claim', async () => {
      const { verifier } = setup()
      const options = { nonce: 'n', nonceHash: 'sha256-hex' as const }
      expect(
        await codeOf(verifier.verify(signToken(key, validClaims({ nonce: 'x' })), options)),
      ).toBe('nonce')
      expect(await codeOf(verifier.verify(signToken(key, validClaims()), options))).toBe(
        'nonce_missing',
      )
    })
  })

  describe('JWKS cache', () => {
    it('reuses keys within the TTL and refetches afterwards', async () => {
      const { verifier, fetch, advance } = setup({ cacheTtlMs: 1000 })
      const token = signToken(key, validClaims({ exp: NOW_S + 100000 }))
      await verifier.verify(token)
      advance(999)
      await verifier.verify(token)
      expect(fetch).toHaveBeenCalledTimes(1)
      advance(1)
      await verifier.verify(token)
      expect(fetch).toHaveBeenCalledTimes(2)
    })

    it('does not refetch for an unknown kid right after a fetch', async () => {
      const { verifier, fetch } = setup()
      const unknown = makeKey('rotated')
      expect(await codeOf(verifier.verify(signToken(unknown, validClaims())))).toBe('key_not_found')
      expect(fetch).toHaveBeenCalledTimes(1)
    })

    it('refreshes once per cooldown on unknown kids, and joins concurrent refreshes', async () => {
      const { verifier, fetch, advance } = setup()
      await verifier.verify(signToken(key, validClaims()))
      advance(60_000)
      const unknown = signToken(makeKey('rotated'), validClaims())
      const results = await Promise.all(
        Array.from({ length: 5 }, () => codeOf(verifier.verify(unknown))),
      )
      expect(results).toEqual(Array(5).fill('key_not_found'))
      expect(fetch).toHaveBeenCalledTimes(2)
      for (let i = 0; i < 10; i += 1) await codeOf(verifier.verify(unknown))
      expect(fetch).toHaveBeenCalledTimes(2)
      advance(60_000)
      await codeOf(verifier.verify(unknown))
      expect(fetch).toHaveBeenCalledTimes(3)
    })

    it('honors a custom refresh cooldown', async () => {
      const { verifier, fetch, advance } = setup({ refreshCooldownMs: 10 })
      await verifier.verify(signToken(key, validClaims()))
      advance(10)
      await codeOf(verifier.verify(signToken(makeKey('rotated'), validClaims())))
      expect(fetch).toHaveBeenCalledTimes(2)
    })

    it('isolates one caller cancelling from other callers sharing the fetch', async () => {
      let release!: (response: Response) => void
      const fetch = vi.fn(() => new Promise<Response>((resolve) => (release = resolve)))
      const verifier = createOidcIdTokenVerifier({
        jwksUri: 'https://issuer.example.com/jwks',
        issuers: ['https://issuer.example.com'],
        audiences: () => ['client-1'],
        fetch,
        now: () => NOW_MS,
      })
      const token = signToken(key, validClaims())
      const controller = new AbortController()
      const cancelled = verifier.verify(token, { signal: controller.signal })
      const surviving = verifier.verify(token)
      const other = verifier.verify(token, { signal: new AbortController().signal })
      controller.abort(new Error('caller gave up'))
      await expect(cancelled).rejects.toThrow('caller gave up')
      release(jsonResponse({ keys: [key.jwk] }))
      await expect(surviving).resolves.toMatchObject({ sub: 'user-1' })
      await expect(other).resolves.toMatchObject({ sub: 'user-1' })
      expect(fetch).toHaveBeenCalledTimes(1)
    })

    it('rejects immediately for an already-aborted signal', async () => {
      const { verifier } = setup()
      const signal = AbortSignal.abort(new Error('already aborted'))
      await expect(verifier.verify(signToken(key, validClaims()), { signal })).rejects.toThrow(
        'already aborted',
      )
    })

    it('picks up a rotated key after the forced refresh', async () => {
      const rotated = makeKey('k2')
      const responses = [[key.jwk], [key.jwk, rotated.jwk]]
      const fetch = vi.fn(async () => jsonResponse({ keys: responses.shift() }))
      let now = NOW_MS
      const verifier = createOidcIdTokenVerifier({
        jwksUri: 'https://issuer.example.com/jwks',
        issuers: ['https://issuer.example.com'],
        audiences: () => ['client-1'],
        fetch,
        now: () => now,
      })
      await verifier.verify(signToken(key, validClaims()))
      now += 60_000
      await expect(
        verifier.verify(signToken(rotated, validClaims({ exp: NOW_S + 1000 }))),
      ).resolves.toBeTruthy()
      expect(fetch).toHaveBeenCalledTimes(2)
    })

    it('clears the cache after a failed fetch', async () => {
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({}, 503))
        .mockResolvedValueOnce(jsonResponse({ nokeys: true }))
        .mockRejectedValueOnce(new Error('network'))
        .mockResolvedValue(jsonResponse({ keys: [key.jwk] }))
      const verifier = createOidcIdTokenVerifier({
        jwksUri: 'https://issuer.example.com/jwks',
        issuers: ['https://issuer.example.com'],
        audiences: () => ['client-1'],
        fetch,
        now: () => NOW_MS,
      })
      const token = signToken(key, validClaims())
      expect(await codeOf(verifier.verify(token))).toBe('jwks_fetch')
      expect(await codeOf(verifier.verify(token))).toBe('jwks_fetch')
      await expect(verifier.verify(token)).rejects.toThrow('network')
      await expect(verifier.verify(token)).resolves.toBeTruthy()
      expect(fetch).toHaveBeenCalledTimes(4)
    })
  })
})
