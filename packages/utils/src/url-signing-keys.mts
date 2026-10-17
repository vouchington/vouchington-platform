import { createHmac, timingSafeEqual } from 'node:crypto'

export function signPathWithKey(path: string, keyHex: string): string {
  if (!/^[\da-f]{64}$/i.test(keyHex))
    throw new Error('Signing keys must be 64 hexadecimal characters')
  return createHmac('sha256', Buffer.from(keyHex, 'hex')).update(path).digest('hex')
}

export function verifyPathWithKey(path: string, signature: string, keyHex: string): boolean {
  const expected = signPathWithKey(path, keyHex)
  if (expected.length !== signature.length || !/^[\da-f]+$/i.test(signature)) return false
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'))
}

/**
 * Parse a comma-separated list of hex keys. Entries are trimmed; empty entries and
 * case-insensitive placeholder entries are skipped.
 */
export function parseSigningKeys(
  value: string | undefined,
  options: { placeholder?: string } = {},
): string[] {
  if (!value) return []
  const placeholder = (options.placeholder ?? 'PLACEHOLDER').toUpperCase()
  return value.split(',').flatMap((entry) => {
    const key = entry.trim()
    return key && key.toUpperCase() !== placeholder ? [key] : []
  })
}

/** Sign with the first usable key. Returns '' when no key is usable. */
export function signPath(path: string, keys: readonly string[]): string {
  for (const key of keys) {
    try {
      return signPathWithKey(path, key)
    } catch {
      // Invalid key: try the next one.
    }
  }
  return ''
}

export type VerifyPathOptions = {
  /** Accept any signature when no keys are configured (dev mode). Defaults to false. */
  allowUnsignedWhenNoKeys?: boolean
}

/** Verify against every key (for rotation). Invalid keys never match. */
export function verifyPathSignature(
  path: string,
  signature: string,
  keys: readonly string[],
  options: VerifyPathOptions = {},
): boolean {
  if (keys.length === 0) return options.allowUnsignedWhenNoKeys === true
  return keys.some((key) => {
    try {
      return verifyPathWithKey(path, signature, key)
    } catch {
      return false
    }
  })
}

function expiringPayload(path: string, expiresAtMs: number): string {
  return `${expiresAtMs}\n${path}`
}

/** Sign a path bound to an expiry (epoch milliseconds). Returns '' when no key is usable. */
export function signExpiringPath(
  path: string,
  expiresAtMs: number,
  keys: readonly string[],
): string {
  return signPath(expiringPayload(path, expiresAtMs), keys)
}

/** Verify an expiring signature. Fails closed for unsafe expiry values and expired links. */
export function verifyExpiringPath(
  path: string,
  expiresAtMs: number,
  signature: string,
  keys: readonly string[],
  options: { now?: number } = {},
): boolean {
  if (!Number.isSafeInteger(expiresAtMs)) return false
  if ((options.now ?? Date.now()) > expiresAtMs) return false
  return verifyPathSignature(expiringPayload(path, expiresAtMs), signature, keys)
}
