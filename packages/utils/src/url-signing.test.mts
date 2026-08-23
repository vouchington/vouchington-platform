import { describe, expect, it } from 'vitest'
import { signPathWithKey, verifyPathWithKey } from './url-signing.mts'

const key = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

describe('path signing', () => {
  it('signs and verifies a path', () => {
    const signature = signPathWithKey('/resource/a', key)
    expect(signature).toMatch(/^[\da-f]{64}$/)
    expect(verifyPathWithKey('/resource/a', signature, key)).toBe(true)
  })

  it('fails closed for tampering, malformed signatures, and keys', () => {
    const signature = signPathWithKey('/resource/a', key)
    expect(verifyPathWithKey('/resource/b', signature, key)).toBe(false)
    expect(verifyPathWithKey('/resource/a', 'not-a-signature', key)).toBe(false)
    expect(() => signPathWithKey('/resource/a', 'bad')).toThrow('64 hexadecimal')
  })
})
