import { createPasskeyAuthentication } from './passkey-authentication.mts'
import { createPasskeyRegistration } from './passkey-registration.mts'
import type { PasskeyOptions } from './passkey-types.mts'

export type {
  PasskeyFailure,
  PasskeyAttestation,
  PasskeyOptions,
  PasskeyRepository,
  PasskeyResidentKey,
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
