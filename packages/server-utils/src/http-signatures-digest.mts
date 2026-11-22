import { createHash, timingSafeEqual } from 'node:crypto'

const DIGEST_HEADER_PATTERN = /^SHA-256=(.+)$/

export function computeDigest(body: string | Buffer): string {
  const bodyBuffer = typeof body === 'string' ? Buffer.from(body, 'utf-8') : body
  const hash = createHash('sha256').update(bodyBuffer).digest('base64')
  return `SHA-256=${hash}`
}

export function extractDigestHash(digestHeader: string): string {
  const match = DIGEST_HEADER_PATTERN.exec(digestHeader)
  if (!match?.[1]) throw new Error('Invalid Digest header format')
  return match[1]
}

export function verifyDigest(body: string | Buffer, expectedDigestHeader: string): boolean {
  const computed = Buffer.from(computeDigest(body))
  const expected = Buffer.from(expectedDigestHeader)
  if (computed.length !== expected.length) return false
  return timingSafeEqual(computed, expected)
}
