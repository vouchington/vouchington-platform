import { createPasskeyAuthentication } from './passkey-authentication.mts'
import { createPasskeyRegistration } from './passkey-registration.mts'
import type { PasskeyOptions } from './passkey-types.mts'

export type {
  AttemptLimiter,
  PasskeyFailure,
  PasskeyAttestation,
  PasskeyOptions,
  PasskeyRepository,
  PasskeyResidentKey,
  PasskeyStateStore,
  PasskeyStateKeys,
  PasskeyUser,
  PasskeyUserVerification,
  StoredPasskey,
} from './passkey-types.mts'

export function createPasskeys<UserId, PasskeyId, Created, RegistrationContext = undefined>(
  options: PasskeyOptions<UserId, PasskeyId, Created, RegistrationContext>,
) {
  return {
    registration: createPasskeyRegistration(options),
    authentication: createPasskeyAuthentication(options),
  }
}

export function createStringPasskeys<PasskeyId, Created, RegistrationContext = undefined>(
  options: Omit<
    PasskeyOptions<string, PasskeyId, Created, RegistrationContext>,
    'serializeUserId' | 'userIdsEqual'
  >,
) {
  return createPasskeys({ ...options, serializeUserId: String, userIdsEqual: (a, b) => a === b })
}
