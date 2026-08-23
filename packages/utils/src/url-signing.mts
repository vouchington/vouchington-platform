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
