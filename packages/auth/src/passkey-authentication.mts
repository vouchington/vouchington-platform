import { generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server'
import { AuthError } from './errors.mts'
import type { PasskeyFailure, PasskeyOptions, StoredPasskey } from './passkey-types.mts'

export function createPasskeyAuthentication<UserId, PasskeyId, Created, RegistrationContext>(
  options: PasskeyOptions<UserId, PasskeyId, Created, RegistrationContext>,
) {
  const namespace = options.namespace ?? 'auth'
  const segment = (value: unknown) => encodeURIComponent(String(value))
  const keys = options.keys
  const userKey = keys
    ? (userId: UserId, deviceId: string) => keys.authentication(userId, deviceId)
    : (userId: UserId, deviceId: string) =>
        `${namespace}:passkey-authentication:${segment(userId)}:${segment(deviceId)}`
  const discoverableKey = keys
    ? (deviceId: string) => keys.discoverableAuthentication(deviceId)
    : (deviceId: string) => `${namespace}:passkey-discoverable-authentication:${segment(deviceId)}`

  async function createOptions(userId: UserId, deviceId: string) {
    const credentialIds = await options.repository.listCredentialIds(userId)
    if (credentialIds.length === 0)
      throw new AuthError('invalid_request', 400, 'No passkeys are registered')
    const generated = await generateAuthenticationOptions({
      rpID: options.rpId,
      allowCredentials: credentialIds.map((id) => ({ id })),
      userVerification: 'preferred',
    })
    await options.state.put(
      userKey(userId, deviceId),
      generated.challenge,
      options.challengeTtlSeconds,
    )
    return generated
  }

  async function createDiscoverableOptions(deviceId: string) {
    const generated = await generateAuthenticationOptions({
      rpID: options.rpId,
      allowCredentials: [],
      userVerification: 'required',
    })
    await options.state.put(
      discoverableKey(deviceId),
      generated.challenge,
      options.challengeTtlSeconds,
    )
    return generated
  }

  async function verify(input: {
    userId: UserId
    deviceId: string
    expectedOrigin: string
    response: unknown
  }): Promise<{ userId: UserId; passkeyId: PasskeyId }> {
    const challenge = await options.state.consume<string>(userKey(input.userId, input.deviceId))
    return verifyWithChallenge(challenge, input.response, input.expectedOrigin, {
      mode: 'user-bound',
      deviceId: input.deviceId,
      userId: input.userId,
    })
  }

  async function verifyDiscoverable(input: {
    deviceId: string
    expectedOrigin: string
    response: unknown
  }): Promise<{ userId: UserId; passkeyId: PasskeyId }> {
    const challenge = await options.state.consume<string>(discoverableKey(input.deviceId))
    return verifyWithChallenge(challenge, input.response, input.expectedOrigin, {
      mode: 'discoverable',
      deviceId: input.deviceId,
    })
  }

  async function verifyWithChallenge(
    challenge: string | null,
    response: unknown,
    expectedOrigin: string,
    failure: PasskeyFailure<UserId>,
  ): Promise<{ userId: UserId; passkeyId: PasskeyId }> {
    if (!challenge)
      throw new AuthError('challenge_expired', 400, 'Authentication challenge expired')
    const credentialId = (response as { id?: unknown })?.id
    const failureWithCredential = {
      ...failure,
      ...(typeof credentialId === 'string' ? { credentialId } : {}),
    }
    if (await options.failureLimiter?.isLimited?.(failureWithCredential)) return rateLimited()
    if (typeof credentialId !== 'string') return invalidPasskey(failureWithCredential)
    const passkey = await options.repository.findByCredentialId(credentialId)
    const expectedUserId = failure.userId
    const userIdsEqual = options.userIdsEqual ?? Object.is
    if (!passkey || (expectedUserId !== undefined && !userIdsEqual(passkey.userId, expectedUserId)))
      return invalidPasskey(failureWithCredential)
    let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>
    try {
      verification = await verifyAuthenticationResponse({
        response: response as Parameters<typeof verifyAuthenticationResponse>[0]['response'],
        expectedChallenge: challenge,
        expectedOrigin,
        expectedRPID: options.rpId,
        credential: toWebAuthnCredential(passkey),
      })
    } catch (error) {
      return invalidPasskey(failureWithCredential, error)
    }
    if (!verification.verified) return invalidPasskey(failureWithCredential)
    await options.repository.updateCounter(passkey.id, verification.authenticationInfo.newCounter)
    return { userId: passkey.userId, passkeyId: passkey.id }
  }

  async function invalidPasskey(failure: PasskeyFailure<UserId>, cause?: unknown): Promise<never> {
    if (await options.failureLimiter?.record(failure)) return rateLimited()
    throw new AuthError(
      'invalid_credentials',
      401,
      'Passkey verification failed',
      cause === undefined ? undefined : { cause },
    )
  }

  return { createOptions, createDiscoverableOptions, verify, verifyDiscoverable }
}

function toWebAuthnCredential<UserId, PasskeyId>(passkey: StoredPasskey<UserId, PasskeyId>) {
  return {
    id: passkey.credentialId,
    publicKey: Uint8Array.from(passkey.publicKey),
    counter: passkey.counter,
    ...(passkey.transports === undefined ? {} : { transports: [...passkey.transports] }),
  }
}

function rateLimited(): never {
  throw new AuthError('rate_limited', 429, 'Too many failed authentication attempts')
}
