import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto'

export type EncryptionKey = { id: string; key: Buffer }
export type TokenSecrets = {
  hashToken(purpose: string, token: string): string
  encryptSecret(plaintext: string, purpose: string): string
  decryptSecret(ciphertext: string, purpose: string): string
}

const KEY_FORMAT = 'v1'

export function parseEncryptionKeys(value: string): EncryptionKey[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .map(parseEncryptionKey)
}

export function createTokenSecrets(options: {
  hashSecret: string
  encryptionKeys: readonly EncryptionKey[]
}): TokenSecrets {
  const hashSecret = options.hashSecret.trim()
  if (!hashSecret) throw new Error('Hash secret must not be empty')
  if (options.encryptionKeys.length === 0)
    throw new Error('Encryption keys must contain at least one key')
  for (const key of options.encryptionKeys) {
    if (!/^[A-Za-z0-9_-]+$/.test(key.id) || key.key.length !== 32)
      throw new Error('Encryption keys must have a non-empty id and 32 bytes')
  }
  const copiedKeys = options.encryptionKeys.map((key) => ({
    id: key.id,
    key: Buffer.from(key.key),
  }))
  const keys = new Map(copiedKeys.map((key) => [key.id, key]))
  if (keys.size !== options.encryptionKeys.length)
    throw new Error('Encryption key ids must be unique')
  const primary = copiedKeys[0]!
  return {
    hashToken: (purpose, token) =>
      createHmac('sha256', hashSecret)
        .update(purpose)
        .update('\0')
        .update(token)
        .digest('hex')
        .toUpperCase(),
    encryptSecret: (plaintext, purpose) => encrypt(plaintext, purpose, primary),
    decryptSecret: (ciphertext, purpose) => decrypt(ciphertext, purpose, keys),
  }
}

function parseEncryptionKey(part: string): EncryptionKey {
  const separator = part.indexOf(':')
  const id = separator < 0 ? '' : part.slice(0, separator).trim()
  if (!/^[A-Za-z0-9_-]+$/.test(id))
    throw new Error('Encryption key entries must use a non-empty safe key id')
  const raw = part.slice(separator + 1).trim()
  const value = raw.startsWith('raw32:')
    ? raw.slice(6).trim()
    : raw.startsWith('base64url:')
      ? raw.slice(10).trim()
      : raw
  if (!value) throw new Error('Encryption key entries must contain key material')
  if (
    !raw.startsWith('raw32:') &&
    (!/^[A-Za-z0-9_-]+$/.test(value) ||
      Buffer.from(value, 'base64url').toString('base64url') !== value)
  )
    throw new Error('Encryption key material must be canonical base64url')
  const key = raw.startsWith('raw32:') ? Buffer.from(value) : Buffer.from(value, 'base64url')
  if (key.length !== 32) throw new Error(`Encryption key ${id} must be 32 bytes`)
  return { id, key }
}

function encrypt(plaintext: string, purpose: string, key: EncryptionKey): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key.key, iv)
  cipher.setAAD(Buffer.from(purpose))
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return [
    KEY_FORMAT,
    key.id,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':')
}

function decrypt(value: string, purpose: string, keys: ReadonlyMap<string, EncryptionKey>): string {
  const [format, id, iv, tag, ciphertext, extra] = value.split(':')
  if (
    format !== KEY_FORMAT ||
    !id ||
    !iv ||
    !tag ||
    ciphertext === undefined ||
    extra !== undefined
  )
    throw new Error('Invalid encrypted secret format')
  const key = keys.get(id)
  if (!key) throw new Error(`Encryption key ${id} is not configured`)
  const ivBytes = decodeCanonicalBase64Url(iv)
  const tagBytes = decodeCanonicalBase64Url(tag)
  const ciphertextBytes = decodeCanonicalBase64Url(ciphertext)
  if (ivBytes.length !== 12 || tagBytes.length !== 16)
    throw new Error('Invalid encrypted secret format')
  const decipher = createDecipheriv('aes-256-gcm', key.key, ivBytes)
  decipher.setAAD(Buffer.from(purpose))
  decipher.setAuthTag(tagBytes)
  return Buffer.concat([decipher.update(ciphertextBytes), decipher.final()]).toString()
}

function decodeCanonicalBase64Url(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new Error('Invalid encrypted secret format')
  const decoded = Buffer.from(value, 'base64url')
  if (decoded.toString('base64url') !== value) throw new Error('Invalid encrypted secret format')
  return decoded
}
