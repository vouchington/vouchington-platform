import { describe, expect, it, vi } from 'vitest'
import { createAuthenticationFlow } from './authentication.mts'
import { AuthError } from './errors.mts'
import { createMfaState } from './mfa.mts'
import { createMfaFlow } from './mfa-flow.mts'
import { createOAuth } from './oauth.mts'
import { createEmailOtp } from './otp.mts'
import type { ExpiringStateStore } from './types.mts'

describe('authentication flow', () => {
  it('issues sessions, gates MFA, and rejects suspended identities', async () => {
    const issueSession = vi.fn(async (user: { id: string }) => `session:${user.id}`)
    const options = {
      resolveUser: vi.fn(async (email: string) => ({ id: email })),
      isSuspended: vi.fn(async () => false),
      suspendedError: () => new AuthError('invalid_credentials', 418, 'Caller-owned rejection'),
      hasMfa: vi.fn(async () => false),
      createMfaAttempt: vi.fn(async () => 'attempt-1'),
      issueSession,
    }
    const authenticate = createAuthenticationFlow(options)
    await expect(authenticate('person@example.test', undefined)).resolves.toEqual({
      status: 'authenticated',
      user: { id: 'person@example.test' },
      session: 'session:person@example.test',
    })

    options.hasMfa.mockResolvedValueOnce(true)
    await expect(authenticate('mfa@example.test', undefined)).resolves.toEqual({
      status: 'mfa_required',
      attemptId: 'attempt-1',
    })
    const suspended = createAuthenticationFlow({
      ...options,
      isSuspended: () => true,
    })
    await expect(suspended('blocked@example.test', undefined)).rejects.toMatchObject({
      code: 'invalid_credentials',
      status: 418,
      message: 'Caller-owned rejection',
    })
  })
})

describe('email OTP', () => {
  it('issues, normalizes, digests, delivers, and atomically verifies tokens', async () => {
    const put = vi.fn(async () => undefined)
    const consume = vi.fn(async () => true)
    const deliver = vi.fn(async () => undefined)
    const now = new Date('2026-01-02T03:04:05.000Z')
    const otp = createEmailOtp({
      normalizeEmail: (email) => email.trim().toLowerCase(),
      generateToken: () => 'AbCd',
      normalizeToken: (token) => token.trim().toUpperCase(),
      digest: (token) => `digest:${token}`,
      store: { put, consume },
      deliver,
      requestLimiter: { record: async () => false },
      verificationLimiter: { record: async () => false },
      ttlSeconds: 60,
      now: () => now,
    })
    await expect(otp.request(' PERSON@EXAMPLE.TEST ', undefined)).resolves.toEqual({
      email: 'person@example.test',
    })
    expect(put).toHaveBeenCalledWith({
      email: 'person@example.test',
      digest: 'digest:ABCD',
      expiresAt: new Date('2026-01-02T03:05:05.000Z'),
    })
    expect(deliver).toHaveBeenCalledWith({
      email: 'person@example.test',
      token: 'AbCd',
      context: undefined,
    })
    await expect(otp.verify('PERSON@EXAMPLE.TEST', ' abcd ', undefined)).resolves.toEqual({
      email: 'person@example.test',
    })
    expect(consume).toHaveBeenCalledWith({
      email: 'person@example.test',
      digest: 'digest:ABCD',
      now,
    })
    consume.mockResolvedValueOnce(false)
    await expect(otp.verify('person@example.test', 'bad', undefined)).rejects.toMatchObject({
      code: 'invalid_credentials',
      status: 401,
    })
  })

  it('uses caller-owned token formats and validates configuration', async () => {
    const delivered: string[] = []
    const otp = createEmailOtp({
      normalizeEmail: String,
      generateToken: () => '123456',
      normalizeToken: String,
      digest: String,
      store: { put: async () => undefined, consume: async () => true },
      deliver: async ({ token }) => void delivered.push(token),
      requestLimiter: { record: async () => false },
      verificationLimiter: { record: async () => false },
      ttlSeconds: 1,
    })
    await otp.request('person@example.test', undefined)
    expect(delivered[0]).toBe('123456')
    expect(() => createEmailOtp({ ...baseOtpOptions(), ttlSeconds: 0 })).toThrow('ttlSeconds')
    expect(() =>
      createEmailOtp({ ...baseOtpOptions(), requestLimiter: undefined } as never),
    ).toThrow('requestLimiter')
    expect(() =>
      createEmailOtp({ ...baseOtpOptions(), verificationLimiter: undefined } as never),
    ).toThrow('verificationLimiter')
    const invalid = createEmailOtp({ ...baseOtpOptions(), generateToken: () => '' })
    await expect(invalid.request('person@example.test', undefined)).rejects.toThrow('generateToken')
  })

  it('runs caller-owned request and verification limiters before side effects', async () => {
    const put = vi.fn(async () => undefined)
    const consume = vi.fn(async () => true)
    const otp = createEmailOtp({
      ...baseOtpOptions(),
      store: { put, consume },
      requestLimiter: { record: async ({ email }) => email === 'limited@example.test' },
      verificationLimiter: { record: async () => true },
    })
    await expect(otp.request('limited@example.test', undefined)).rejects.toMatchObject({
      code: 'rate_limited',
    })
    expect(put).not.toHaveBeenCalled()
    await expect(otp.verify('person@example.test', 'token', undefined)).rejects.toMatchObject({
      code: 'rate_limited',
    })
    expect(consume).not.toHaveBeenCalled()
  })
})

describe('MFA state', () => {
  it('peeks, consumes, requires, and creates one-time reauthentication state', async () => {
    const store = memoryStateStore()
    const mfa = createMfaState<{ userId: string }>({
      store,
      attemptTtlSeconds: 300,
      reauthenticationTtlSeconds: 120,
      namespace: 'site',
      createId: sequence('attempt', 'reauth'),
    })
    expect(await mfa.createAttempt({ userId: 'user-1' })).toBe('attempt')
    await expect(mfa.peekAttempt('attempt')).resolves.toEqual({ userId: 'user-1' })
    await expect(mfa.requireAttempt('attempt')).resolves.toEqual({ userId: 'user-1' })
    await expect(mfa.consumeAttempt('attempt')).resolves.toEqual({ userId: 'user-1' })
    await expect(mfa.requireAttempt('attempt')).rejects.toBeInstanceOf(AuthError)
    expect(await mfa.createReauthentication('user-1')).toBe('reauth')
    await expect(mfa.consumeReauthentication('user-1', 'reauth')).resolves.toBe(true)
    await expect(mfa.consumeReauthentication('user-1', 'reauth')).resolves.toBe(false)
  })

  it('supports defaults and validates TTLs', async () => {
    const mfa = createMfaState({
      store: memoryStateStore(),
      attemptTtlSeconds: 1,
      reauthenticationTtlSeconds: 1,
    })
    expect(await mfa.createAttempt('attempt')).toMatch(/^[0-9a-f-]{36}$/)
    expect(() => createMfaState({ ...baseMfaOptions(), attemptTtlSeconds: 0 })).toThrow(
      'attemptTtlSeconds',
    )
    expect(() => createMfaState({ ...baseMfaOptions(), reauthenticationTtlSeconds: 0 })).toThrow(
      'reauthenticationTtlSeconds',
    )
  })

  it('supports compatibility key builders and validates generated identifiers', async () => {
    const put = vi.fn(async (_key: string, _value: unknown, _ttlSeconds: number) => undefined)
    const store: ExpiringStateStore = {
      put,
      get: async () => null,
      consume: async () => null,
    }
    const mfa = createMfaState({
      store,
      attemptTtlSeconds: 300,
      reauthenticationTtlSeconds: 300,
      createId: () => 'valid-id',
      isValidId: (id) => id === 'valid-id',
      keys: {
        attempt: (id) => `legacy-attempt:${id}`,
        reauthentication: (userId, token) => `legacy-reauth:${userId}:${token}`,
      },
    })
    await mfa.createAttempt('value')
    await mfa.createReauthentication('user')
    expect(put.mock.calls.map(([key]) => key)).toEqual([
      'legacy-attempt:valid-id',
      'legacy-reauth:user:valid-id',
    ])
    await expect(mfa.peekAttempt('invalid')).resolves.toBeNull()
    await expect(mfa.consumeAttempt('invalid')).resolves.toBeNull()
    await expect(mfa.requireAttempt('invalid')).rejects.toMatchObject({
      code: 'invalid_credentials',
    })
    await expect(mfa.consumeReauthentication('user', 'invalid')).resolves.toBe(false)

    const invalidAttemptId = createMfaState({
      store,
      attemptTtlSeconds: 1,
      reauthenticationTtlSeconds: 1,
      createId: () => 'invalid',
      isValidId: () => false,
    })
    await expect(invalidAttemptId.createAttempt('value')).rejects.toThrow('invalid identifier')
    await expect(invalidAttemptId.createReauthentication('user')).rejects.toThrow(
      'invalid identifier',
    )

    const unicode = createMfaState({
      ...baseMfaOptions(),
      createId: () => 'valid-😀',
    })
    await expect(unicode.createAttempt('value')).resolves.toBe('valid-😀')
    await expect(unicode.peekAttempt('\ud800')).resolves.toBeNull()
    await expect(unicode.consumeAttempt('\udc00')).resolves.toBeNull()
    await expect(unicode.createReauthentication('\ud800')).rejects.toThrow('well-formed Unicode')
    await expect(unicode.consumeReauthentication('\udc00', 'valid-😀')).resolves.toBe(false)
  })
})

describe('MFA verification flow', () => {
  it('retains failed attempts, rate-limits failures, and consumes only successful attempts', async () => {
    const state = createMfaState<{ userId: string }>({
      store: memoryStateStore(),
      attemptTtlSeconds: 300,
      reauthenticationTtlSeconds: 300,
      createId: sequence(
        'failed-attempt',
        'limited-attempt',
        'successful-attempt',
        'prelimited-attempt',
      ),
    })
    const record = vi.fn(async ({ factor }: { factor: string }) => factor === 'limited')
    const flow = createMfaFlow({
      state,
      limiter: { record },
      verify: async ({ factor }) => factor === 'valid',
      complete: async ({ attempt }) => `session:${attempt.userId}`,
    })
    const failedId = await state.createAttempt({ userId: 'user-1' })
    await expect(
      flow({ attemptId: failedId, factor: 'bad', context: undefined }),
    ).rejects.toMatchObject({ code: 'invalid_credentials' })
    await expect(state.peekAttempt(failedId)).resolves.toEqual({ userId: 'user-1' })
    const limitedId = await state.createAttempt({ userId: 'user-2' })
    await expect(
      flow({ attemptId: limitedId, factor: 'limited', context: undefined }),
    ).rejects.toMatchObject({ code: 'rate_limited' })
    const successfulId = await state.createAttempt({ userId: 'user-3' })
    await expect(
      flow({ attemptId: successfulId, factor: 'valid', context: undefined }),
    ).resolves.toBe('session:user-3')
    await expect(state.peekAttempt(successfulId)).resolves.toBeNull()

    await expect(
      flow({ attemptId: 'missing', factor: 'valid', context: undefined }),
    ).rejects.toMatchObject({ code: 'invalid_credentials' })

    const prelimited = createMfaFlow({
      state,
      limiter: { isLimited: async () => true, record: async () => false },
      verify: async () => true,
      complete: async () => 'unused',
    })
    const prelimitedId = await state.createAttempt({ userId: 'user-4' })
    await expect(
      prelimited({ attemptId: prelimitedId, factor: 'valid', context: undefined }),
    ).rejects.toMatchObject({ code: 'rate_limited' })

    const disappeared = createMfaFlow({
      state: { peekAttempt: async () => ({ userId: 'user-5' }), consumeAttempt: async () => null },
      limiter: { record: async () => false },
      verify: async () => true,
      complete: async () => 'unused',
    })
    await expect(
      disappeared({ attemptId: 'raced', factor: 'valid', context: undefined }),
    ).rejects.toMatchObject({ code: 'invalid_credentials' })

    const falsy = createMfaFlow({
      state: { peekAttempt: async () => 0, consumeAttempt: async () => 0 },
      limiter: { record: async () => false },
      verify: async () => true,
      complete: async ({ attempt }) => attempt,
    })
    await expect(falsy({ attemptId: 'zero', factor: true, context: undefined })).resolves.toBe(0)
  })
})

describe('OAuth orchestration', () => {
  it('resolves caller-owned providers for connect and continue', async () => {
    const exchange = vi.fn(async (input: string) => ({ subject: input }))
    const oauth = createOAuth({
      getProvider: (provider) => (provider === 'example' ? { exchange } : undefined),
      isKnownProvider: (provider) => provider === 'example' || provider === 'disabled',
      connect: async ({ provider, userId, account }) => ({ provider, userId, account }),
      continue: async ({ provider, account }) => ({ provider, account }),
    })
    await expect(
      oauth.connect({
        provider: 'example',
        userId: 'user-1',
        authorization: 'code-1',
        expectedOrigin: 'https://example.test',
        context: undefined,
      }),
    ).resolves.toEqual({
      provider: 'example',
      userId: 'user-1',
      account: { subject: 'code-1' },
    })
    await expect(
      oauth.continue({ provider: 'example', authorization: 'code-2', context: undefined }),
    ).resolves.toEqual({ provider: 'example', account: { subject: 'code-2' } })
    expect(exchange).toHaveBeenLastCalledWith('code-2', undefined)
    await expect(
      oauth.continue({ provider: 'disabled', authorization: 'code', context: undefined }),
    ).rejects.toMatchObject({ code: 'provider_disabled', status: 404 })
    const withKnownProviders = createOAuth({
      getProvider: () => ({ exchange }),
      isKnownProvider: () => false,
      connect: async () => undefined,
      continue: async () => undefined,
    })
    await expect(
      withKnownProviders.continue({
        provider: 'unknown',
        authorization: 'code',
        context: undefined,
      }),
    ).rejects.toMatchObject({ code: 'invalid_request', status: 400 })
  })
})

function baseOtpOptions() {
  return {
    normalizeEmail: String,
    generateToken: () => 'token',
    normalizeToken: String,
    digest: String,
    store: { put: async () => undefined, consume: async () => false },
    deliver: async () => undefined,
    requestLimiter: { record: async () => false },
    verificationLimiter: { record: async () => false },
    ttlSeconds: 1,
  }
}

function baseMfaOptions() {
  return {
    store: memoryStateStore(),
    attemptTtlSeconds: 1,
    reauthenticationTtlSeconds: 1,
  }
}

function memoryStateStore(): ExpiringStateStore {
  const values = new Map<string, unknown>()
  return {
    put: async (key, value) => void values.set(key, value),
    get: async <T,>(key: string) => (values.get(key) as T | undefined) ?? null,
    consume: async <T,>(key: string) => {
      const value = values.get(key) as T | undefined
      values.delete(key)
      return value ?? null
    },
  }
}

function sequence(...values: string[]): () => string {
  return () => values.shift()!
}
