import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto'

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

export function assertPublicKeyPem(pem: string): void {
  if (pem.includes('PRIVATE')) throw new Error('Invalid public key PEM format')
  try {
    createPublicKey(pem)
  } catch {
    throw new Error('Invalid public key PEM format')
  }
}

export function assertPrivateKeyPem(pem: string): void {
  try {
    createPrivateKey(pem)
  } catch {
    throw new Error('Invalid private key PEM format')
  }
}
