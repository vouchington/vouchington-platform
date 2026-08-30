import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPasskeys } from './passkeys.mts'
import type { PasskeyRepository, StoredPasskey } from './passkey-types.mts'
import type { ExpiringStateStore } from './types.mts'

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

  it('validates relying-party configuration', () => {
    expect(() => createPasskeys({ ...baseOptions(), rpId: ' ' })).toThrow('rpId')
    expect(() => createPasskeys({ ...baseOptions(), rpName: ' ' })).toThrow('rpName')
    expect(() => createPasskeys({ ...baseOptions(), challengeTtlSeconds: 0 })).toThrow(
      'challengeTtlSeconds',
    )
  })

  it('encodes identifiers in default state keys', async () => {
    const { options, put } = configured()
    const { namespace: _namespace, ...defaultOptions } = options
    const passkeys = createPasskeys(defaultOptions)
    await passkeys.registration.createOptions({ id: 'user:1', name: 'name' }, 'device:1')
    expect(put).toHaveBeenLastCalledWith(
      'auth:passkey-registration:user%3A1:device%3A1',
      'registration-challenge',
      300,
    )
  })

  it('creates and verifies registration ceremonies through injected storage', async () => {
    const { options, repository, put } = configured()
    const passkeys = createPasskeys({ ...options, userIdsEqual: (left, right) => left === right })
    await expect(
      passkeys.registration.createOptions(
        { id: 'user-1', name: 'person@example.test' },
        'device-1',
      ),
    ).resolves.toEqual({ challenge: 'registration-challenge' })
    expect(webauthn.generateRegistrationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        rpID: 'example.test',
        rpName: 'Example',
        userDisplayName: 'person@example.test',
        excludeCredentials: [{ id: 'credential-1' }],
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
      { id: 'user-1', name: 'name', displayName: 'Display' },
      'device-1',
    )
    webauthn.verifyRegistrationResponse.mockResolvedValueOnce({ verified: true })
    await expect(verifyRegistration(passkeys)).rejects.toMatchObject({
      code: 'invalid_credentials',
    })
    await passkeys.registration.createOptions({ id: 'user-1', name: 'name' }, 'device-1')
    const registrationInfo = { credential: { id: 'credential-2' } }
    webauthn.verifyRegistrationResponse.mockResolvedValueOnce({
      verified: true,
      registrationInfo,
    })
    await expect(verifyRegistration(passkeys)).resolves.toBe('created-passkey')
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
    await passkeys.registration.createOptions({ id: 'user-1', name: 'name' }, 'device-1')
    webauthn.verifyRegistrationResponse.mockRejectedValueOnce(new Error('malformed response'))
    await expect(verifyRegistration(passkeys)).rejects.toMatchObject({
      code: 'invalid_credentials',
      status: 400,
      cause: expect.any(Error),
    })
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
      allowCredentials: [{ id: 'credential-1' }],
      userVerification: 'preferred',
    })
    await passkeys.authentication.createDiscoverableOptions('device-2')
    expect(webauthn.generateAuthenticationOptions).toHaveBeenLastCalledWith({
      rpID: 'example.test',
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
    const { options, repository } = configured()
    const passkeys = createPasskeys(options)
    await expect(verifyAuthentication(passkeys, {})).rejects.toMatchObject({
      code: 'challenge_expired',
    })
    await createAuthenticationChallenge(passkeys)
    await expect(verifyAuthentication(passkeys, {})).rejects.toMatchObject({
      code: 'invalid_credentials',
    })
    await createAuthenticationChallenge(passkeys)
    repository.findByCredentialId.mockResolvedValueOnce(null)
    await expect(verifyAuthentication(passkeys)).rejects.toMatchObject({
      code: 'invalid_credentials',
    })
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
    const { options, repository } = configured()
    const passkeys = createPasskeys({ ...options, userIdsEqual: (left, right) => left === right })
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
  })

  it('supports legacy state keys and caller-owned failed-attempt limiting', async () => {
    const { options, put } = configured()
    const passkeys = createPasskeys({
      ...options,
      keys: {
        registration: (userId, deviceId) => `legacy-reg:${userId}:${deviceId}`,
        authentication: (userId, deviceId) => `legacy-auth:${userId}:${deviceId}`,
        discoverableAuthentication: (deviceId) => `legacy-discoverable:${deviceId}`,
      },
      failureLimiter: { record: async () => true },
    })
    await passkeys.registration.createOptions({ id: 'user-1', name: 'name' }, 'device-1')
    expect(put).toHaveBeenLastCalledWith(
      'legacy-reg:user-1:device-1',
      'registration-challenge',
      300,
    )
    await passkeys.authentication.createDiscoverableOptions('device-2')
    await expect(
      passkeys.authentication.verifyDiscoverable({
        deviceId: 'device-2',
        expectedOrigin: 'https://example.test',
        response: {},
      }),
    ).rejects.toMatchObject({ code: 'rate_limited', status: 429 })

    await passkeys.authentication.createOptions('user-1', 'device-3')
    expect(put).toHaveBeenLastCalledWith(
      'legacy-auth:user-1:device-3',
      'authentication-challenge',
      300,
    )
  })

  it('rejects attempts that are already limited', async () => {
    const { options } = configured()
    const passkeys = createPasskeys({
      ...options,
      failureLimiter: { isLimited: async () => true, record: async () => false },
    })
    await passkeys.authentication.createOptions('user-1', 'device-1')
    await expect(verifyAuthentication(passkeys)).rejects.toMatchObject({
      code: 'rate_limited',
      status: 429,
    })
  })
})

function configured() {
  const values = new Map<string, unknown>()
  const put = vi.fn(async (key: string, value: unknown) => void values.set(key, value))
  const state: ExpiringStateStore = {
    put,
    get: async <T,>(key: string) => (values.get(key) as T | undefined) ?? null,
    consume: async <T,>(key: string) => {
      const value = values.get(key) as T | undefined
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
    updateCounter: vi.fn(async () => undefined),
  } satisfies PasskeyRepository<string, string, string, string>
  return {
    state,
    put,
    repository,
    options: {
      rpId: 'example.test',
      rpName: 'Example',
      challengeTtlSeconds: 300,
      state,
      repository,
      namespace: 'site',
    },
  }
}

function baseOptions() {
  const { options } = configured()
  return options
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
