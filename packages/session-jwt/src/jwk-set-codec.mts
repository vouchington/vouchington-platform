import type * as jose from 'jose'
import { parseJwkSet, type ManagedJwk } from './keys.mts'

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

/** Encodes a JWK array as base64 JSON, suitable for a single environment variable or secret. */
export function encodeJwkSet(jwks: readonly jose.JWK[]): string {
  let binary = ''
  for (const byte of encoder.encode(JSON.stringify(jwks))) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/**
 * Decodes base64 JSON (an array of JWKs, a `{ keys }` JWKS, or one JWK) and validates it with
 * `parseJwkSet`. Uses only `atob`/`TextDecoder`, so it also runs in worker runtimes without Buffer.
 * `label` names the source (for example an environment variable) in thrown messages.
 */
export function parseBase64JwkSet(encoded: string, label: string): readonly ManagedJwk[] {
  let value: unknown
  try {
    const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0))
    value = JSON.parse(decoder.decode(bytes))
  } catch (error) {
    throw new Error(
      `${label} must be valid base64-encoded JSON: ${error instanceof Error ? error.message : 'unknown error'}`,
      { cause: error },
    )
  }
  return parseJwkSet(value, label)
}
