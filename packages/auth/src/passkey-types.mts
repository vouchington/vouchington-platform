import type {
  AuthenticatorTransportFuture,
  VerifiedRegistrationResponse,
} from '@simplewebauthn/server'
import type { ExpiringStateStore } from './types.mts'
import type { AttemptLimiter } from './types.mts'

export interface StoredPasskey<UserId = string, PasskeyId = string> {
  id: PasskeyId
  userId: UserId
  credentialId: string
  publicKey: Uint8Array
  counter: number
  transports?: readonly AuthenticatorTransportFuture[]
}

export interface PasskeyRepository<
  UserId = string,
  PasskeyId = string,
  Created = unknown,
  RegistrationContext = undefined,
> {
  listCredentialIds(userId: UserId): Promise<readonly string[]>
  findByCredentialId(credentialId: string): Promise<StoredPasskey<UserId, PasskeyId> | null>
  create(input: {
    userId: UserId
    registration: NonNullable<VerifiedRegistrationResponse['registrationInfo']>
    context: RegistrationContext
  }): Promise<Created>
  /** Atomically update only when the stored counter is lower; return whether it advanced. */
  updateCounter(passkeyId: PasskeyId, counter: number): Promise<boolean>
}

export type PasskeyFailure<UserId> = {
  mode: 'user-bound' | 'discoverable'
  deviceId: string
  userId?: UserId
  credentialId?: string
}

export interface PasskeyStateKeys<UserId> {
  registration(userId: UserId, deviceId: string): string
  authentication(userId: UserId, deviceId: string): string
  discoverableAuthentication(deviceId: string): string
}

export interface PasskeyOptions<
  UserId = string,
  PasskeyId = string,
  Created = unknown,
  RegistrationContext = undefined,
> {
  rpId: string
  rpName: string
  challengeTtlSeconds: number
  state: ExpiringStateStore
  repository: PasskeyRepository<UserId, PasskeyId, Created, RegistrationContext>
  residentKey: PasskeyResidentKey
  namespace?: string
  keys?: PasskeyStateKeys<UserId>
  failureLimiter?: AttemptLimiter<PasskeyFailure<UserId>>
  userIdsEqual?: (left: UserId, right: UserId) => boolean
  userVerification: {
    registration: PasskeyUserVerification
    authentication: PasskeyUserVerification
    discoverableAuthentication: PasskeyUserVerification
  }
}

export interface PasskeyUser<UserId = string> {
  id: UserId
  /** Stable, non-PII WebAuthn user handle (1–64 bytes). */
  webAuthnUserId: Uint8Array
  name: string
  displayName?: string
}

export type PasskeyUserVerification = 'discouraged' | 'preferred' | 'required'
export type PasskeyResidentKey = 'discouraged' | 'preferred' | 'required'
