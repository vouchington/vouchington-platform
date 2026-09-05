import { describe, expect, it } from 'vitest'
import { computeDigest, extractDigestHash, verifyDigest } from './http-signatures.mts'

describe('HTTP Signature digest', () => {
  it('computes SHA-256 digests for strings, buffers, empty bodies, and distinct content', () => {
    expect(computeDigest('hello world')).toMatch(/^SHA-256=/)
    expect(computeDigest(Buffer.from('hello world', 'utf-8'))).toBe(computeDigest('hello world'))
    expect(computeDigest('body 1')).not.toBe(computeDigest('body 2'))
    expect(computeDigest('')).toMatch(/^SHA-256=/)
  })

  it('extracts base64 hashes and rejects malformed Digest headers', () => {
    expect(extractDigestHash('SHA-256=abc123def456')).toBe('abc123def456')
    expect(extractDigestHash('SHA-256=abc+def/ghi=')).toBe('abc+def/ghi=')
    expect(() => extractDigestHash('MD5=abc123')).toThrow('Invalid Digest header format')
    expect(() => extractDigestHash('')).toThrow('Invalid Digest header format')
    expect(() => extractDigestHash('SHA-256=')).toThrow('Invalid Digest header format')
  })

  it('verifies matching digests and rejects mismatches or invalid headers', () => {
    const body = 'test body'
    expect(verifyDigest(body, computeDigest(body))).toBe(true)
    expect(verifyDigest(Buffer.from(body, 'utf-8'), computeDigest(body))).toBe(true)
    expect(verifyDigest('different body', computeDigest('original body'))).toBe(false)
    expect(verifyDigest('body', 'not-a-valid-digest')).toBe(false)
    expect(verifyDigest('body', '')).toBe(false)
  })
})
