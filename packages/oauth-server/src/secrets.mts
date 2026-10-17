import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/** Opaque URL-safe random value with a caller-chosen prefix. */
export function generateOpaqueToken(prefix: string, bytes = 32): string {
  return `${prefix}${randomBytes(bytes).toString('base64url')}`
}

/** Constant-time string equality. Digesting first hides length differences from the comparison. */
export function safeEqual(left: string, right: string): boolean {
  const a = createHash('sha256').update(left).digest()
  const b = createHash('sha256').update(right).digest()
  return timingSafeEqual(a, b)
}
