import { createSign, generateKeyPairSync } from 'node:crypto'

export const NOW_MS = Date.UTC(2026, 0, 1)
export const NOW_S = NOW_MS / 1000

export function makeKey(kid: string) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  return { kid, privateKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid } }
}

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')

export function signToken(
  key: ReturnType<typeof makeKey>,
  claims: Record<string, unknown>,
  header: Record<string, unknown> = {},
): string {
  const signed = `${b64({ alg: 'RS256', kid: key.kid, ...header })}.${b64(claims)}`
  const signature = createSign('SHA256').update(signed).sign(key.privateKey).toString('base64url')
  return `${signed}.${signature}`
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

export function validClaims(overrides: Record<string, unknown> = {}) {
  return {
    iss: 'https://issuer.example.com',
    aud: 'client-1',
    sub: 'user-1',
    iat: NOW_S,
    exp: NOW_S + 600,
    ...overrides,
  }
}
