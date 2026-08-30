import type {
  AuthenticatorAttachment,
  AuthenticatorTransportFuture,
  COSEAlgorithmIdentifier,
  VerifiedRegistrationResponse,
} from '@simplewebauthn/server'
import type { AttemptLimiter } from './types.mts'

export interface PasskeyStateStore {
  put(key: string, challenge: string, ttlSeconds: number): Promise<void>
  /** Atomically read and delete the challenge so concurrent ceremonies cannot both succeed. */
  consume(key: string): Promise<string | null>
}

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
  /** Atomically accept an advancing counter, or a repeated zero for counterless authenticators. */
  updateCounter(passkeyId: PasskeyId, counter: number): Promise<boolean>
}

export type PasskeyFailure<UserId> =
  | { mode: 'user-bound'; deviceId: string; userId: UserId; credentialId?: string }
  | { mode: 'discoverable'; deviceId: string; credentialId?: string }

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
  timeoutMs: number
  state: PasskeyStateStore
  repository: PasskeyRepository<UserId, PasskeyId, Created, RegistrationContext>
  attestationType: PasskeyAttestation
  authenticatorAttachment: AuthenticatorAttachment | null
  supportedAlgorithmIDs: readonly COSEAlgorithmIdentifier[]
  residentKey: PasskeyResidentKey
  namespace?: string
  keys?: PasskeyStateKeys<UserId>
  /** Records credential-bearing verification failures; false rejects the failed attempt as limited. */
  failureLimiter: AttemptLimiter<PasskeyFailure<UserId>>
  userIdsEqual: (left: UserId, right: UserId) => boolean
  serializeUserId(userId: UserId): string
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
export type PasskeyAttestation = 'none' | 'indirect' | 'direct' | 'enterprise'
