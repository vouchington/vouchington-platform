import { describe, expect, it } from 'vitest'
import { computeDigest, verifyDigest } from './http-signatures-digest.mts'
import { generateRsaSha256KeyPair } from './http-signatures-keys.mts'
import { buildSignatureHeaders } from './http-signatures-sign.mts'
import {
  defaultSignPolicy,
  defaultVerifyPolicy,
  FULL_HEADERS,
  KEY_ID,
} from './http-signatures-test-helpers.mts'
import { verifySignature } from './http-signatures-verify.mts'

function verifyUrl(
  method: string,
  url: string,
  body: string | Buffer,
  publicKeyPem: string,
  signatureHeaders: { signature: string; digest: string; date: string },
) {
  const parsed = new URL(url)
  return verifySignature({
    method,
    path: parsed.pathname + parsed.search,
    host: parsed.host,
    body,
    signatureHeader: signatureHeaders.signature,
    digestHeader: signatureHeaders.digest,
    dateHeader: signatureHeaders.date,
    publicKeyPem,
    ...defaultVerifyPolicy,
  })
}

describe('HTTP Signature signing', () => {
  it('round-trips RSA signatures across methods, query strings, buffers, and large bodies', () => {
    const keypair = generateRsaSha256KeyPair()
    const url = 'https://mastodon.example/inbox'
    const body = JSON.stringify({ type: 'Follow', object: 'https://example.test' })
    const signed = buildSignatureHeaders({
      method: 'POST',
      url,
      body,
      keyId: KEY_ID,
      privateKeyPem: keypair.privateKeyPem,
      ...defaultSignPolicy,
    })
    expect(verifyUrl('POST', url, body, keypair.publicKeyPem, signed).valid).toBe(true)
    expect(
      verifyUrl(
        'GET',
        'https://mastodon.example/users/alice/outbox?page=1',
        '',
        keypair.publicKeyPem,
        buildSignatureHeaders({
          method: 'GET',
          url: 'https://mastodon.example/users/alice/outbox?page=1',
          body: '',
          keyId: KEY_ID,
          privateKeyPem: keypair.privateKeyPem,
          ...defaultSignPolicy,
        }),
      ).valid,
    ).toBe(true)
    const bufferBody = Buffer.from(body, 'utf-8')
    expect(
      verifyUrl(
        'POST',
        url,
        body,
        keypair.publicKeyPem,
        buildSignatureHeaders({
          method: 'POST',
          url,
          body: bufferBody,
          keyId: KEY_ID,
          privateKeyPem: keypair.privateKeyPem,
          ...defaultSignPolicy,
        }),
      ).valid,
    ).toBe(true)
    const largeBody = JSON.stringify({ content: 'A'.repeat(10_000) })
    expect(
      verifyUrl(
        'POST',
        url,
        largeBody,
        keypair.publicKeyPem,
        buildSignatureHeaders({
          method: 'POST',
          url,
          body: largeBody,
          keyId: KEY_ID,
          privateKeyPem: keypair.privateKeyPem,
          ...defaultSignPolicy,
        }),
      ).valid,
    ).toBe(true)
    for (const method of ['GET', 'POST', 'DELETE', 'PUT']) {
      expect(
        verifyUrl(
          method,
          url,
          '',
          keypair.publicKeyPem,
          buildSignatureHeaders({
            method,
            url,
            body: '',
            keyId: KEY_ID,
            privateKeyPem: keypair.privateKeyPem,
            ...defaultSignPolicy,
          }),
        ).valid,
      ).toBe(true)
    }
  })

  it('detects tampered bodies, wrong keys, and malformed PEMs', () => {
    const first = generateRsaSha256KeyPair()
    const second = generateRsaSha256KeyPair()
    const url = 'https://mastodon.example/inbox'
    const original = JSON.stringify({ object: 'https://example.test' })
    const signed = buildSignatureHeaders({
      method: 'POST',
      url,
      body: original,
      keyId: KEY_ID,
      privateKeyPem: first.privateKeyPem,
      ...defaultSignPolicy,
    })
    const tampered = verifyUrl(
      'POST',
      url,
      JSON.stringify({ object: 'https://malicious.example' }),
      first.publicKeyPem,
      signed,
    )
    expect(tampered.valid).toBe(false)
    expect(tampered.error).toContain('Digest verification failed')
    const wrongKey = verifyUrl('POST', url, original, second.publicKeyPem, signed)
    expect(wrongKey.valid).toBe(false)
    expect(wrongKey.error).toContain('Signature verification failed')
    expect(() =>
      buildSignatureHeaders({
        method: 'POST',
        url,
        body: '{}',
        keyId: KEY_ID,
        privateKeyPem: 'not a pem',
        ...defaultSignPolicy,
      }),
    ).toThrow('Invalid private key PEM format')
  })

  it('requires caller-owned signed headers and algorithms', () => {
    const { privateKeyPem } = generateRsaSha256KeyPair()
    expect(() =>
      buildSignatureHeaders({
        method: 'POST',
        url: 'https://mastodon.example/inbox',
        body: '{}',
        keyId: KEY_ID,
        privateKeyPem,
        signedHeaders: [],
        algorithm: 'rsa-sha256',
      }),
    ).toThrow('signedHeaders must not be empty')
    expect(() =>
      buildSignatureHeaders({
        method: 'POST',
        url: 'https://mastodon.example/inbox',
        body: '{}',
        keyId: KEY_ID,
        privateKeyPem,
        signedHeaders: FULL_HEADERS,
        algorithm: 'sha1',
      }),
    ).toThrow('Unsupported signature algorithm: sha1')
    expect(() =>
      buildSignatureHeaders({
        method: 'POST',
        url: 'https://mastodon.example/inbox',
        body: '{}',
        keyId: KEY_ID,
        privateKeyPem,
        signedHeaders: [...defaultSignPolicy.signedHeaders, 'content-type'],
        algorithm: 'rsa-sha256',
      }),
    ).toThrow('Unknown signed header: content-type')
    const digest = computeDigest('hello')
    expect(verifyDigest('hello', digest)).toBe(true)
    expect(verifyDigest('other', digest)).toBe(false)
    const hs2019 = generateRsaSha256KeyPair()
    const signedHs2019 = buildSignatureHeaders({
      method: 'POST',
      url: 'https://mastodon.example/inbox',
      body: '{}',
      keyId: KEY_ID,
      privateKeyPem: hs2019.privateKeyPem,
      signedHeaders: FULL_HEADERS,
      algorithm: 'hs2019',
    })
    expect(
      verifyUrl('POST', 'https://mastodon.example/inbox', '{}', hs2019.publicKeyPem, signedHs2019)
        .valid,
    ).toBe(true)
    const withContentType = buildSignatureHeaders({
      method: 'POST',
      url: 'https://mastodon.example/inbox',
      body: '{}',
      keyId: KEY_ID,
      privateKeyPem: hs2019.privateKeyPem,
      signedHeaders: [...FULL_HEADERS, 'content-type'],
      algorithm: 'rsa-sha256',
      additionalHeaders: { 'content-type': 'application/activity+json' },
    })
    expect(withContentType.signature).toContain('content-type')
  })
})
