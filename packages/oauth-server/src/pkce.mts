import { createHash } from 'node:crypto'
import { invalidGrant, invalidRequest } from './errors.mts'
import { safeEqual } from './secrets.mts'

const PKCE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/
const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/

/** RFC 7636 S256 challenge for a verifier. The plain method is never accepted. */
export function createPkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

export function validatePkceChallenge(challenge: unknown, method: unknown): string {
  if (method !== 'S256') throw invalidRequest('code_challenge_method must be S256')
  if (typeof challenge !== 'string' || !PKCE_CHALLENGE_PATTERN.test(challenge)) {
    throw invalidRequest('code_challenge is invalid')
  }
  return challenge
}

export function validatePkceVerifier(verifier: unknown): string {
  if (typeof verifier !== 'string' || !PKCE_VERIFIER_PATTERN.test(verifier)) {
    throw invalidGrant('code_verifier is invalid')
  }
  return verifier
}

/** Timing-safe check that `verifier` produced the stored S256 `challenge`. */
export function verifyPkce(challenge: string, verifier: string): boolean {
  return safeEqual(challenge, createPkceChallenge(verifier))
}
