import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPasskeys, createStringPasskeys } from './passkeys.mts'
import type { PasskeyRepository, PasskeyStateStore, StoredPasskey } from './passkey-types.mts'

type TestPasskeys = ReturnType<typeof createPasskeys<string, string, string, string>>

const webauthn = vi.hoisted(() => ({
  generateRegistrationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
  generateAuthenticationOptions: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}))

vi.mock('@simplewebauthn/server', () => webauthn)

describe('passkeys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    webauthn.generateRegistrationOptions.mockResolvedValue({ challenge: 'registration-challenge' })
    webauthn.generateAuthenticationOptions.mockResolvedValue({
      challenge: 'authentication-challenge',
    })
  })

  it('encodes identifiers in default state keys', async () => {
    const { options, put } = configured()
    const { namespace: _namespace, ...defaultOptions } = options
    const passkeys = createPasskeys({
      ...defaultOptions,
      authenticatorAttachment: null,
      serializeUserId: (userId) => `id=${userId}`,
    })
    await passkeys.registration.createOptions(testUser({ id: 'user:1' }), 'device:1')
    expect(put).toHaveBeenLastCalledWith(
      'auth:passkey-registration:id%3Duser%3A1:device%3A1',
      'registration-challenge',
      300,
    )
  })

  it('rejects malformed Unicode before building default state keys', async () => {
    const passkeys = createPasskeys(baseOptions())
    await expect(passkeys.registration.createOptions(testUser(), '\ud800')).rejects.toMatchObject({
      code: 'invalid_request',
      status: 400,
    })
    await expect(passkeys.authentication.createOptions('user-1', '\udc00')).rejects.toMatchObject({
      code: 'invalid_request',
      status: 400,
    })
    await expect(passkeys.authentication.createDiscoverableOptions('\ud800')).rejects.toMatchObject(
      { code: 'invalid_request', status: 400 },
    )
    const invalidUserId = createPasskeys({ ...baseOptions(), serializeUserId: () => '' })
    await expect(
      invalidUserId.registration.createOptions(testUser(), 'device-1'),
    ).rejects.toMatchObject({ code: 'invalid_request', status: 400 })
  })

  it('creates and verifies registration ceremonies through injected storage', async () => {
    const { options, repository, put } = configured()
    const passkeys = createPasskeys({ ...options, userIdsEqual: (left, right) => left === right })
    await expect(passkeys.registration.createOptions(testUser(), 'device-1')).resolves.toEqual({
      challenge: 'registration-challenge',
    })
    expect(webauthn.generateRegistrationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        rpID: 'example.test',
        rpName: 'Example',
        timeout: 60_000,
        userID: new Uint8Array([7, 8, 9]),
        attestationType: 'none',
        supportedAlgorithmIDs: [-8, -7, -257],
        userDisplayName: 'person@example.test',
        excludeCredentials: [{ id: 'credential-1' }],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          residentKey: 'discouraged',
          userVerification: 'preferred',
        },
      }),
    )
    expect(put).toHaveBeenCalledWith(
      'site:passkey-registration:user-1:device-1',
      'registration-challenge',
      300,
    )

    webauthn.verifyRegistrationResponse.mockResolvedValueOnce({ verified: false })
    await expect(verifyRegistration(passkeys)).rejects.toMatchObject({
      code: 'invalid_credentials',
    })
    await passkeys.registration.createOptions(
      testUser({ name: 'name', displayName: 'Display' }),
      'device-1',
    )
    webauthn.verifyRegistrationResponse.mockResolvedValueOnce({ verified: true })
    await expect(verifyRegistration(passkeys)).rejects.toMatchObject({
      code: 'invalid_credentials',
    })
    await passkeys.registration.createOptions(testUser({ name: 'name' }), 'device-1')
    const registrationInfo = { credential: { id: 'credential-2' } }
    webauthn.verifyRegistrationResponse.mockResolvedValueOnce({
      verified: true,
      registrationInfo,
    })
    await expect(verifyRegistration(passkeys)).resolves.toBe('created-passkey')
    expect(webauthn.verifyRegistrationResponse).toHaveBeenLastCalledWith(
      expect.objectContaining({
        requireUserVerification: false,
        supportedAlgorithmIDs: [-8, -7, -257],
      }),
    )
    expect(repository.create).toHaveBeenCalledWith({
      userId: 'user-1',
      registration: registrationInfo,
      context: 'My passkey',
    })
    await expect(verifyRegistration(passkeys)).rejects.toMatchObject({ code: 'challenge_expired' })
  })

  it('normalizes registration verifier failures', async () => {
    const { options } = configured()
    const passkeys = createPasskeys(options)
    await passkeys.registration.createOptions(testUser({ name: 'name' }), 'device-1')
    webauthn.verifyRegistrationResponse.mockRejectedValueOnce(new Error('malformed response'))
    await expect(verifyRegistration(passkeys)).rejects.toMatchObject({
      code: 'invalid_credentials',
      status: 400,
      cause: expect.any(Error),
    })
  })

  it('requires a stable WebAuthn user handle', async () => {
    const passkeys = createPasskeys(baseOptions())
    await expect(
      passkeys.registration.createOptions(
        testUser({ webAuthnUserId: new Uint8Array() }),
        'device-1',
      ),
    ).rejects.toThrow('webAuthnUserId')
    await expect(
      passkeys.registration.createOptions(
        testUser({ webAuthnUserId: new Uint8Array(65) }),
        'device-1',
      ),
    ).rejects.toThrow('webAuthnUserId')
  })

  it('creates user-bound and discoverable authentication options', async () => {
    const { options, repository, put } = configured()
    const passkeys = createPasskeys(options)
    repository.listCredentialIds.mockResolvedValueOnce([])
    await expect(passkeys.authentication.createOptions('user-1', 'device-1')).rejects.toMatchObject(
      {
        code: 'invalid_request',
      },
    )
    await passkeys.authentication.createOptions('user-1', 'device-1')
    expect(webauthn.generateAuthenticationOptions).toHaveBeenCalledWith({
      rpID: 'example.test',
      timeout: 60_000,
      allowCredentials: [{ id: 'credential-1' }],
      userVerification: 'preferred',
    })
    await passkeys.authentication.createDiscoverableOptions('device-2')
    expect(webauthn.generateAuthenticationOptions).toHaveBeenLastCalledWith({
      rpID: 'example.test',
      timeout: 60_000,
      allowCredentials: [],
      userVerification: 'required',
    })
    expect(put).toHaveBeenLastCalledWith(
      'site:passkey-discoverable-authentication:device-2',
      'authentication-challenge',
      300,
    )
  })

  it('rejects invalid assertions without creating identities', async () => {
    const { options, repository, reserve } = configured()
    const passkeys = createPasskeys(options)
    await expect(verifyAuthentication(passkeys, {})).rejects.toMatchObject({
      code: 'challenge_expired',
    })
    await createAuthenticationChallenge(passkeys)
    await expect(verifyAuthentication(passkeys, {})).rejects.toMatchObject({
      code: 'invalid_credentials',
    })
    expect(reserve).not.toHaveBeenCalled()
    await createAuthenticationChallenge(passkeys)
    repository.findByCredentialId.mockResolvedValueOnce(null)
    await expect(verifyAuthentication(passkeys)).rejects.toMatchObject({
      code: 'invalid_credentials',
    })
    expect(reserve).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'user-bound', credentialId: 'credential-1' }),
    )
    await createAuthenticationChallenge(passkeys)
    repository.findByCredentialId.mockResolvedValueOnce({ ...storedPasskey(), userId: 'user-2' })
    await expect(verifyAuthentication(passkeys)).rejects.toMatchObject({
      code: 'invalid_credentials',
    })
    await createAuthenticationChallenge(passkeys)
    webauthn.verifyAuthenticationResponse.mockRejectedValueOnce(new Error('bad assertion'))
    await expect(verifyAuthentication(passkeys)).rejects.toMatchObject({
      code: 'invalid_credentials',
      cause: expect.any(Error),
    })
    await createAuthenticationChallenge(passkeys)
    webauthn.verifyAuthenticationResponse.mockResolvedValueOnce({ verified: false })
    await expect(verifyAuthentication(passkeys)).rejects.toMatchObject({
      code: 'invalid_credentials',
    })
  })

  it('updates counters for user-bound and discoverable successful assertions', async () => {
    const { options, repository, reserve } = configured()
    const passkeys = createStringPasskeys(options)
    webauthn.verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 8 },
    })
    await createAuthenticationChallenge(passkeys)
    await expect(verifyAuthentication(passkeys)).resolves.toEqual({
      userId: 'user-1',
      passkeyId: 'passkey-1',
    })
    expect(webauthn.verifyAuthenticationResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        credential: expect.objectContaining({ id: 'credential-1', counter: 7 }),
        requireUserVerification: false,
      }),
    )
    repository.findByCredentialId.mockResolvedValueOnce({
      ...storedPasskey(),
      transports: ['internal'],
    })
    await passkeys.authentication.createDiscoverableOptions('device-2')
    await expect(
      passkeys.authentication.verifyDiscoverable({
        deviceId: 'device-2',
        expectedOrigin: 'https://example.test',
        response: { id: 'credential-1' },
      }),
    ).resolves.toEqual({ userId: 'user-1', passkeyId: 'passkey-1' })
    expect(repository.updateCounter).toHaveBeenCalledTimes(2)
    expect(repository.updateCounter).toHaveBeenCalledWith('passkey-1', 8)
    expect(reserve).not.toHaveBeenCalled()
  })

  it('keeps caller-owned user-verification policies consistent', async () => {
    const { options } = configured()
    const passkeys = createPasskeys({
      ...options,
      attestationType: 'indirect',
      authenticatorAttachment: 'cross-platform',
      supportedAlgorithmIDs: [-7],
      userVerification: {
        registration: 'required',
        authentication: 'required',
        discoverableAuthentication: 'preferred',
      },
    })
    await passkeys.registration.createOptions(testUser(), 'device-1')
    expect(webauthn.generateRegistrationOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        attestationType: 'indirect',
        supportedAlgorithmIDs: [-7],
        authenticatorSelection: expect.objectContaining({
          authenticatorAttachment: 'cross-platform',
        }),
      }),
    )
    webauthn.verifyRegistrationResponse.mockResolvedValueOnce({ verified: false })
    await expect(verifyRegistration(passkeys)).rejects.toMatchObject({
      code: 'invalid_credentials',
    })
    expect(webauthn.verifyRegistrationResponse).toHaveBeenLastCalledWith(
      expect.objectContaining({ requireUserVerification: true }),
    )

    await passkeys.authentication.createOptions('user-1', 'device-1')
    webauthn.verifyAuthenticationResponse.mockResolvedValueOnce({ verified: false })
    await expect(verifyAuthentication(passkeys)).rejects.toMatchObject({
      code: 'invalid_credentials',
    })
    expect(webauthn.verifyAuthenticationResponse).toHaveBeenLastCalledWith(
      expect.objectContaining({ requireUserVerification: true }),
    )

    await passkeys.authentication.createDiscoverableOptions('device-2')
    webauthn.verifyAuthenticationResponse.mockResolvedValueOnce({ verified: false })
    await expect(
      passkeys.authentication.verifyDiscoverable({
        deviceId: 'device-2',
        expectedOrigin: 'https://example.test',
        response: { id: 'credential-1' },
      }),
    ).rejects.toMatchObject({ code: 'invalid_credentials' })
    expect(webauthn.verifyAuthenticationResponse).toHaveBeenLastCalledWith(
      expect.objectContaining({ requireUserVerification: false }),
    )
  })

  it('rejects a verified assertion when an atomic counter update loses a race', async () => {
    const { options, repository } = configured()
    repository.updateCounter.mockResolvedValueOnce(false)
    webauthn.verifyAuthenticationResponse.mockResolvedValueOnce({
      verified: true,
      authenticationInfo: { newCounter: 8 },
    })
    const passkeys = createPasskeys(options)
    await createAuthenticationChallenge(passkeys)
    await expect(verifyAuthentication(passkeys)).rejects.toMatchObject({
      code: 'invalid_credentials',
    })
  })

  it('records successful use for authenticators without counter support', async () => {
    const { options, repository } = configured()
    repository.findByCredentialId.mockResolvedValueOnce({ ...storedPasskey(), counter: 0 })
    webauthn.verifyAuthenticationResponse.mockResolvedValueOnce({
      verified: true,
      authenticationInfo: { newCounter: 0 },
    })
    const passkeys = createPasskeys(options)
    await createAuthenticationChallenge(passkeys)
    await expect(verifyAuthentication(passkeys)).resolves.toEqual({
      userId: 'user-1',
      passkeyId: 'passkey-1',
    })
    expect(repository.updateCounter).toHaveBeenCalledWith('passkey-1', 0)
  })

  it('supports legacy state keys and caller-owned failed-attempt limiting', async () => {
    const { options, put, repository } = configured()
    const passkeys = createPasskeys({
      ...options,
      keys: {
        registration: (userId, deviceId) => `legacy-reg:${userId}:${deviceId}`,
        authentication: (userId, deviceId) => `legacy-auth:${userId}:${deviceId}`,
        discoverableAuthentication: (deviceId) => `legacy-discoverable:${deviceId}`,
      },
      failureLimiter: { reserve: async () => false },
    })
    await passkeys.registration.createOptions(testUser({ name: 'name' }), 'device-1')
    expect(put).toHaveBeenLastCalledWith(
      'legacy-reg:user-1:device-1',
      'registration-challenge',
      300,
    )
    await passkeys.authentication.createDiscoverableOptions('device-2')
    repository.findByCredentialId.mockResolvedValueOnce(null)
    await expect(
      passkeys.authentication.verifyDiscoverable({
        deviceId: 'device-2',
        expectedOrigin: 'https://example.test',
        response: { id: 'missing' },
      }),
    ).rejects.toMatchObject({ code: 'rate_limited', status: 429 })

    await passkeys.authentication.createOptions('user-1', 'device-3')
    expect(put).toHaveBeenLastCalledWith(
      'legacy-auth:user-1:device-3',
      'authentication-challenge',
      300,
    )
  })

  it('rate-limits failed assertions after verification', async () => {
    const { options } = configured()
    const passkeys = createPasskeys({
      ...options,
      failureLimiter: { reserve: async () => false },
    })
    await passkeys.authentication.createOptions('user-1', 'device-1')
    webauthn.verifyAuthenticationResponse.mockResolvedValueOnce({ verified: false })
    await expect(verifyAuthentication(passkeys)).rejects.toMatchObject({
      code: 'rate_limited',
      status: 429,
    })
  })
})

function configured() {
  const values = new Map<string, unknown>()
  const put = vi.fn(async (key: string, value: unknown) => void values.set(key, value))
  const state: PasskeyStateStore = {
    put,
    consume: async (key: string) => {
      const value = values.get(key) as string | undefined
      values.delete(key)
      return value ?? null
    },
  }
  const repository = {
    listCredentialIds: vi.fn(async () => ['credential-1']),
    findByCredentialId: vi.fn<PasskeyRepository<string, string, string>['findByCredentialId']>(
      async () => storedPasskey(),
    ),
    create: vi.fn(
      async (_input: Parameters<PasskeyRepository<string, string, string, string>['create']>[0]) =>
        'created-passkey',
    ),
    updateCounter: vi.fn(async () => true),
  } satisfies PasskeyRepository<string, string, string, string>
  const reserve = vi.fn(async () => true)
  return {
    state,
    put,
    repository,
    options: {
      rpId: 'example.test',
      rpName: 'Example',
      challengeTtlSeconds: 300,
      timeoutMs: 60_000,
      state,
      repository,
      namespace: 'site',
      attestationType: 'none' as const,
      authenticatorAttachment: 'platform' as const,
      supportedAlgorithmIDs: [-8, -7, -257],
      residentKey: 'discouraged' as const,
      userIdsEqual: (left: string, right: string) => left === right,
      serializeUserId: String,
      failureLimiter: { reserve },
      userVerification: {
        registration: 'preferred' as const,
        authentication: 'preferred' as const,
        discoverableAuthentication: 'required' as const,
      },
    },
    reserve,
  }
}

function baseOptions() {
  const { options } = configured()
  return options
}

function testUser(
  overrides: Partial<Parameters<TestPasskeys['registration']['createOptions']>[0]> = {},
) {
  return {
    id: 'user-1',
    webAuthnUserId: new Uint8Array([7, 8, 9]),
    name: 'person@example.test',
    ...overrides,
  }
}

function storedPasskey(): StoredPasskey<string, string> {
  return {
    id: 'passkey-1',
    userId: 'user-1',
    credentialId: 'credential-1',
    publicKey: new Uint8Array([1, 2, 3]),
    counter: 7,
  }
}

async function createAuthenticationChallenge(passkeys: TestPasskeys) {
  await passkeys.authentication.createOptions('user-1', 'device-1')
}

function verifyAuthentication(passkeys: TestPasskeys, response: unknown = { id: 'credential-1' }) {
  return passkeys.authentication.verify({
    userId: 'user-1',
    deviceId: 'device-1',
    expectedOrigin: 'https://example.test',
    response,
  })
}

function verifyRegistration(passkeys: TestPasskeys) {
  return passkeys.registration.verify({
    userId: 'user-1',
    deviceId: 'device-1',
    expectedOrigin: 'https://example.test',
    response: { id: 'credential-1' },
    context: 'My passkey',
  })
}
