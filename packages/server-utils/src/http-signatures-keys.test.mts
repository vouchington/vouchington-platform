import { createPrivateKey, createPublicKey } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  assertPrivateKeyPem,
  assertPublicKeyPem,
  generateRsaSha256KeyPair,
} from './http-signatures-keys.mts'

describe('HTTP Signature key management', () => {
  it('generates unique RSA-2048 PEM keypairs', () => {
    const first = generateRsaSha256KeyPair()
    const second = generateRsaSha256KeyPair()
    expect(createPublicKey(first.publicKeyPem).type).toBe('public')
    expect(createPrivateKey(first.privateKeyPem).type).toBe('private')
    expect(first.publicKeyPem).not.toBe(second.publicKeyPem)
    expect(first.privateKeyPem).not.toBe(second.privateKeyPem)
  })

  it('accepts generated PEMs and rejects malformed or swapped key material', () => {
    const { publicKeyPem, privateKeyPem } = generateRsaSha256KeyPair()
    expect(() => assertPublicKeyPem(publicKeyPem)).not.toThrow()
    expect(() => assertPrivateKeyPem(privateKeyPem)).not.toThrow()
    expect(() => assertPublicKeyPem(privateKeyPem)).toThrow('Invalid public key PEM format')
    expect(() => assertPrivateKeyPem(publicKeyPem)).toThrow('Invalid private key PEM format')
    expect(() => assertPublicKeyPem('not a valid PEM')).toThrow('Invalid public key PEM format')
    expect(() => assertPublicKeyPem('-----BEGIN PUBLIC KEY-----\nabc')).toThrow(
      'Invalid public key PEM format',
    )
    expect(() => assertPublicKeyPem('')).toThrow('Invalid public key PEM format')
    expect(() => assertPrivateKeyPem('not a valid PEM')).toThrow('Invalid private key PEM format')
    expect(() => assertPrivateKeyPem('-----BEGIN PRIVATE KEY-----\nabc')).toThrow(
      'Invalid private key PEM format',
    )
    expect(() => assertPrivateKeyPem('')).toThrow('Invalid private key PEM format')
    expect(() => assertPublicKeyPem('-----BEGIN RUBBISH-----\nabc\n-----END RUBBISH-----')).toThrow(
      'Invalid public key PEM format',
    )
  })
})
