import { generateKeyPairSync } from 'node:crypto'

export type RsaSha256KeyPair = {
  publicKeyPem: string
  privateKeyPem: string
}

export function generateRsaSha256KeyPair(): RsaSha256KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  return { publicKeyPem: publicKey, privateKeyPem: privateKey }
}

function assertPemFormat(pem: string, label: string): void {
  if (!pem.includes('-----BEGIN') || !pem.includes('-----END')) {
    throw new Error(`Invalid ${label} PEM format`)
  }
}

export function assertPublicKeyPem(pem: string): void {
  assertPemFormat(pem, 'public key')
}

export function assertPrivateKeyPem(pem: string): void {
  assertPemFormat(pem, 'private key')
}
