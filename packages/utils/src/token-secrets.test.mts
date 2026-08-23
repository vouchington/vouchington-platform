import { describe, expect, it } from 'vitest'
import { createTokenSecrets, parseEncryptionKeys } from './token-secrets.mts'

const material = 'this fake test key is not secret'

describe('token secrets', () => {
  it('hashes by purpose and round-trips purpose-bound encrypted secrets', () => {
    const secrets = createTokenSecrets({
      hashSecret: 'hash',
      encryptionKeys: parseEncryptionKeys(`new:raw32:${material}`),
    })
    expect(secrets.hashToken('one', 'token')).not.toBe(secrets.hashToken('two', 'token'))
    const ciphertext = secrets.encryptSecret('token', 'purpose')
    expect(ciphertext).toMatch(/^v1:new:/)
    expect(secrets.decryptSecret(ciphertext, 'purpose')).toBe('token')
    expect(() => secrets.decryptSecret(ciphertext, 'other')).toThrow()
  })

  it('supports key rotation and rejects malformed keys or ciphertext', () => {
    const old = createTokenSecrets({
      hashSecret: 'hash',
      encryptionKeys: parseEncryptionKeys(`old:raw32:${material}`),
    })
    const ciphertext = old.encryptSecret('token', 'purpose')
    const rotated = createTokenSecrets({
      hashSecret: 'hash',
      encryptionKeys: parseEncryptionKeys(`new:raw32:${material},old:raw32:${material}`),
    })
    expect(rotated.decryptSecret(ciphertext, 'purpose')).toBe('token')
    expect(() => parseEncryptionKeys('missing:')).toThrow()
    expect(() => rotated.decryptSecret('bad', 'purpose')).toThrow('Invalid encrypted secret format')
  })

  it('rejects duplicate ids before encryption and decryption can disagree', () => {
    const key = parseEncryptionKeys(`same:raw32:${material}`)[0]!
    expect(() => createTokenSecrets({ hashSecret: 'hash', encryptionKeys: [key, key] })).toThrow(
      'unique',
    )
  })

  it('rejects absent, invalid, and unavailable encryption keys', () => {
    expect(() => parseEncryptionKeys('')).toThrow('safe key id')
    expect(() => parseEncryptionKeys('missing')).toThrow('key id')
    expect(() => parseEncryptionKeys('id:raw32:short')).toThrow('32 bytes')
    expect(() => parseEncryptionKeys(`id:raw32:${material},`)).toThrow('safe key id')
    expect(() => parseEncryptionKeys(`bad.id:raw32:${material}`)).toThrow('safe key id')
    const key = parseEncryptionKeys(`id:raw32:${material}`)[0]!
    expect(() => createTokenSecrets({ hashSecret: '', encryptionKeys: [key] })).toThrow(
      'Hash secret',
    )
    expect(() => createTokenSecrets({ hashSecret: 'hash', encryptionKeys: [] })).toThrow(
      'at least one',
    )
    expect(() =>
      createTokenSecrets({
        hashSecret: 'hash',
        encryptionKeys: [{ id: '', key: Buffer.alloc(32) }],
      }),
    ).toThrow('non-empty')
    expect(() =>
      createTokenSecrets({
        hashSecret: 'hash',
        encryptionKeys: [{ id: 'id', key: Buffer.alloc(1) }],
      }),
    ).toThrow('32 bytes')
    const secrets = createTokenSecrets({ hashSecret: 'hash', encryptionKeys: [key] })
    const unknown = secrets.encryptSecret('token', 'purpose').replace(':id:', ':other:')
    expect(() => secrets.decryptSecret(unknown, 'purpose')).toThrow('not configured')
    expect(() =>
      createTokenSecrets({
        hashSecret: 'hash',
        encryptionKeys: [{ id: 'bad:id', key: Buffer.alloc(32) }],
      }),
    ).toThrow('non-empty')
  })

  it('accepts prefixed and unprefixed base64url key material', () => {
    const encoded = Buffer.from(material).toString('base64url')
    expect(parseEncryptionKeys(`one:base64url:${encoded}`)[0]?.key).toHaveLength(32)
    expect(parseEncryptionKeys(`two:${encoded}`)[0]?.key).toHaveLength(32)
    expect(() => parseEncryptionKeys('bad:base64url:***')).toThrow('canonical')
  })

  it('round-trips empty plaintext after caller key mutation', () => {
    const input = parseEncryptionKeys(`id:raw32:${material}`)[0]!
    const secrets = createTokenSecrets({ hashSecret: 'hash', encryptionKeys: [input] })
    input.key.fill(0)
    expect(secrets.decryptSecret(secrets.encryptSecret('', 'purpose'), 'purpose')).toBe('')
  })

  it('rejects non-canonical and incorrectly sized encrypted segments', () => {
    const secrets = createTokenSecrets({
      hashSecret: 'hash',
      encryptionKeys: parseEncryptionKeys(`id:raw32:${material}`),
    })
    const parts = secrets.encryptSecret('token', 'purpose').split(':')
    const tampered = (index: number, value: string) =>
      parts.map((part, partIndex) => (partIndex === index ? value : part)).join(':')

    expect(() => secrets.decryptSecret(tampered(2, `${parts[2]}!`), 'purpose')).toThrow(
      'Invalid encrypted secret format',
    )
    expect(() => secrets.decryptSecret(tampered(3, `${parts[3]}!`), 'purpose')).toThrow(
      'Invalid encrypted secret format',
    )
    expect(() => secrets.decryptSecret(tampered(4, `${parts[4]}!`), 'purpose')).toThrow(
      'Invalid encrypted secret format',
    )
    expect(() => secrets.decryptSecret(tampered(4, 'A'), 'purpose')).toThrow(
      'Invalid encrypted secret format',
    )
    expect(() =>
      secrets.decryptSecret(tampered(2, Buffer.alloc(11).toString('base64url')), 'purpose'),
    ).toThrow('Invalid encrypted secret format')
    expect(() =>
      secrets.decryptSecret(tampered(3, Buffer.alloc(15).toString('base64url')), 'purpose'),
    ).toThrow('Invalid encrypted secret format')
  })
})
