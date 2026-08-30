import { generateRegistrationOptions, verifyRegistrationResponse } from '@simplewebauthn/server'
import { AuthError } from './errors.mts'
import type { PasskeyOptions, PasskeyUser } from './passkey-types.mts'

export function createPasskeyRegistration<UserId, PasskeyId, Created, RegistrationContext>(
  options: PasskeyOptions<UserId, PasskeyId, Created, RegistrationContext>,
) {
  validateOptions(options)
  const defaults = defaultKeys<UserId>(options.namespace)
  const keys = options.keys
  const key = keys
    ? (userId: UserId, deviceId: string) => keys.registration(userId, deviceId)
    : defaults.registration

  return {
    async createOptions(user: PasskeyUser<UserId>, deviceId: string) {
      validateUserHandle(user.webAuthnUserId)
      const credentialIds = await options.repository.listCredentialIds(user.id)
      const userVerification = options.userVerification.registration
      const generated = await generateRegistrationOptions({
        rpName: options.rpName,
        rpID: options.rpId,
        userName: user.name,
        userID: Uint8Array.from(user.webAuthnUserId),
        userDisplayName: user.displayName ?? user.name,
        excludeCredentials: credentialIds.map((id) => ({ id })),
        authenticatorSelection: {
          residentKey: options.residentKey,
          userVerification,
        },
      })
      await options.state.put(
        key(user.id, deviceId),
        generated.challenge,
        options.challengeTtlSeconds,
      )
      return generated
    },

    async verify(input: {
      userId: UserId
      deviceId: string
      expectedOrigin: string
      response: unknown
      context: RegistrationContext
    }): Promise<Created> {
      const challenge = await options.state.consume<string>(key(input.userId, input.deviceId))
      if (!challenge)
        throw new AuthError('challenge_expired', 400, 'Registration challenge expired')
      let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>
      try {
        verification = await verifyRegistrationResponse({
          response: input.response as Parameters<typeof verifyRegistrationResponse>[0]['response'],
          expectedChallenge: challenge,
          expectedOrigin: input.expectedOrigin,
          expectedRPID: options.rpId,
          requireUserVerification: options.userVerification.registration === 'required',
        })
      } catch (error) {
        throw new AuthError('invalid_credentials', 400, 'Registration verification failed', {
          cause: error,
        })
      }
      if (!verification.verified || !verification.registrationInfo)
        throw new AuthError('invalid_credentials', 400, 'Registration verification failed')
      return options.repository.create({
        userId: input.userId,
        registration: verification.registrationInfo,
        context: input.context,
      })
    },
  }
}

function validateUserHandle(userId: Uint8Array) {
  if (!(userId instanceof Uint8Array) || userId.byteLength === 0 || userId.byteLength > 64)
    throw new TypeError('webAuthnUserId must contain between 1 and 64 bytes')
}

function defaultKeys<UserId>(namespace = 'auth') {
  const segment = (value: unknown) => encodeURIComponent(String(value))
  return {
    registration: (userId: UserId, deviceId: string) =>
      `${namespace}:passkey-registration:${segment(userId)}:${segment(deviceId)}`,
  }
}

function validateOptions(options: {
  rpId: string
  rpName: string
  challengeTtlSeconds: number
  residentKey?: unknown
  userVerification?: {
    registration?: unknown
    authentication?: unknown
    discoverableAuthentication?: unknown
  }
}) {
  if (!options.rpId.trim()) throw new TypeError('rpId must not be empty')
  if (!options.rpName.trim()) throw new TypeError('rpName must not be empty')
  if (!Number.isSafeInteger(options.challengeTtlSeconds) || options.challengeTtlSeconds <= 0)
    throw new TypeError('challengeTtlSeconds must be a positive safe integer')
  if (!isPolicy(options.residentKey))
    throw new TypeError('residentKey policy must be explicitly configured')
  const policies = options.userVerification
  if (
    !policies ||
    !isPolicy(policies.registration) ||
    !isPolicy(policies.authentication) ||
    !isPolicy(policies.discoverableAuthentication)
  )
    throw new TypeError('all userVerification policies must be explicitly configured')
}

function isPolicy(value: unknown) {
  return value === 'discouraged' || value === 'preferred' || value === 'required'
}
