import { generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server'
import { AuthError } from './errors.mts'
import type { PasskeyFailure, PasskeyOptions, StoredPasskey } from './passkey-types.mts'
import { encodeStateSegment } from './state-key.mts'

export function createPasskeyAuthentication<UserId, PasskeyId, Created, RegistrationContext>(
  options: PasskeyOptions<UserId, PasskeyId, Created, RegistrationContext>,
) {
  const namespace = options.namespace ?? 'auth'
  const keys = options.keys
  const userKey = keys
    ? (userId: UserId, deviceId: string) => keys.authentication(userId, deviceId)
    : (userId: UserId, deviceId: string) =>
        `${namespace}:passkey-authentication:${encodeStateSegment(userId)}:${encodeStateSegment(deviceId)}`
  const discoverableKey = keys
    ? (deviceId: string) => keys.discoverableAuthentication(deviceId)
    : (deviceId: string) =>
        `${namespace}:passkey-discoverable-authentication:${encodeStateSegment(deviceId)}`

  async function createOptions(userId: UserId, deviceId: string) {
    const credentialIds = await options.repository.listCredentialIds(userId)
    if (credentialIds.length === 0)
      throw new AuthError('invalid_request', 400, 'No passkeys are registered')
    const userVerification = options.userVerification.authentication
    const generated = await generateAuthenticationOptions({
      rpID: options.rpId,
      allowCredentials: credentialIds.map((id) => ({ id })),
      userVerification,
    })
    await options.state.put(
      userKey(userId, deviceId),
      generated.challenge,
      options.challengeTtlSeconds,
    )
    return generated
  }

  async function createDiscoverableOptions(deviceId: string) {
    const userVerification = options.userVerification.discoverableAuthentication
    const generated = await generateAuthenticationOptions({
      rpID: options.rpId,
      allowCredentials: [],
      userVerification,
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
    if (await options.failureLimiter.isLimited?.(failureWithCredential)) return rateLimited()
    if (typeof credentialId !== 'string') return invalidPasskey(failureWithCredential)
    const passkey = await options.repository.findByCredentialId(credentialId)
    const expectedUserId = failure.userId
    if (
      !passkey ||
      (expectedUserId !== undefined && !options.userIdsEqual(passkey.userId, expectedUserId))
    )
      return invalidPasskey(failureWithCredential)
    let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>
    try {
      verification = await verifyAuthenticationResponse({
        response: response as Parameters<typeof verifyAuthenticationResponse>[0]['response'],
        expectedChallenge: challenge,
        expectedOrigin,
        expectedRPID: options.rpId,
        credential: toWebAuthnCredential(passkey),
        requireUserVerification: requiresUserVerification(options, failure.mode),
      })
    } catch (error) {
      return invalidPasskey(failureWithCredential, error)
    }
    if (!verification.verified) return invalidPasskey(failureWithCredential)
    const newCounter = verification.authenticationInfo.newCounter
    if (newCounter !== passkey.counter) {
      const updated = await options.repository.updateCounter(passkey.id, newCounter)
      if (!updated) return invalidPasskey(failureWithCredential)
    }
    return { userId: passkey.userId, passkeyId: passkey.id }
  }

  async function invalidPasskey(failure: PasskeyFailure<UserId>, cause?: unknown): Promise<never> {
    if (await options.failureLimiter.record(failure)) return rateLimited()
    throw new AuthError(
      'invalid_credentials',
      401,
      'Passkey verification failed',
      cause === undefined ? undefined : { cause },
    )
  }

  return { createOptions, createDiscoverableOptions, verify, verifyDiscoverable }
}

function requiresUserVerification(
  options: Pick<PasskeyOptions, 'userVerification'>,
  mode: PasskeyFailure<unknown>['mode'],
) {
  const requirement =
    mode === 'discoverable'
      ? options.userVerification.discoverableAuthentication
      : options.userVerification.authentication
  return requirement === 'required'
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
