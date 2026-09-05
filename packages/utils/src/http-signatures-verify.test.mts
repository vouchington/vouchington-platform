import { describe, expect, it } from 'vitest'
import { computeDigest } from './http-signatures-digest.mts'
import { generateRsaSha256KeyPair } from './http-signatures-keys.mts'
import {
  BODY,
  buildManualSignature,
  digestAndDate,
  FULL_HEADERS,
  KEY_ID,
  verifyArgs,
} from './http-signatures-test-helpers.mts'
import { extractSignatureKeyId, verifySignature } from './http-signatures-verify.mts'

describe('verifySignature', () => {
  it('rejects invalid, stale, and future dates unless maxAgeSeconds is widened', () => {
    const { privateKeyPem, publicKeyPem } = generateRsaSha256KeyPair()
    const digestHeader = computeDigest(BODY)
    expect(
      verifySignature(
        verifyArgs(publicKeyPem, 'headers="(request-target) host date digest",signature="abc"', {
          dateHeader: 'not-a-real-date',
          digestHeader,
        }),
      ),
    ).toEqual({ valid: false, error: 'Invalid date header' })
    const staleDate = new Date(Date.now() - 2 * 60 * 60 * 1000).toUTCString()
    const staleHeader = buildManualSignature({
      privateKeyPem,
      dateHeader: staleDate,
      digestHeader,
      headerNames: FULL_HEADERS,
    })
    const stale = verifySignature(
      verifyArgs(publicKeyPem, staleHeader, { dateHeader: staleDate, digestHeader }),
    )
    expect(stale.valid).toBe(false)
    expect(stale.error).toContain('Date header too old')
    const futureDate = new Date(Date.now() + 2 * 60 * 60 * 1000).toUTCString()
    const futureHeader = buildManualSignature({
      privateKeyPem,
      dateHeader: futureDate,
      digestHeader,
      headerNames: FULL_HEADERS,
    })
    const future = verifySignature(
      verifyArgs(publicKeyPem, futureHeader, { dateHeader: futureDate, digestHeader }),
    )
    expect(future.valid).toBe(false)
    expect(future.error).toContain('Date header too old')
    expect(
      verifySignature(
        verifyArgs(publicKeyPem, staleHeader, {
          dateHeader: staleDate,
          digestHeader,
          maxAgeSeconds: 24 * 60 * 60,
        }),
      ).valid,
    ).toBe(true)
  })

  it('uses caller-required headers instead of a baked header set', () => {
    const { privateKeyPem, publicKeyPem } = generateRsaSha256KeyPair()
    const { digestHeader, dateHeader } = digestAndDate()
    const missingHost = buildManualSignature({
      privateKeyPem,
      dateHeader,
      digestHeader,
      headerNames: ['(request-target)', 'date', 'digest'],
    })
    const withHostRequired = verifySignature(
      verifyArgs(publicKeyPem, missingHost, { digestHeader, dateHeader }),
    )
    expect(withHostRequired.valid).toBe(false)
    expect(withHostRequired.error).toBe(
      'Signature must cover (request-target), host, date, digest (missing: host)',
    )
    expect(
      verifySignature(
        verifyArgs(publicKeyPem, missingHost, {
          digestHeader,
          dateHeader,
          requiredHeaders: ['(request-target)', 'date', 'digest'],
        }),
      ).valid,
    ).toBe(true)
    const onlyTargetDigest = buildManualSignature({
      privateKeyPem,
      dateHeader,
      digestHeader,
      headerNames: ['(request-target)', 'digest'],
    })
    expect(
      verifySignature(verifyArgs(publicKeyPem, onlyTargetDigest, { digestHeader, dateHeader }))
        .error,
    ).toBe('Signature must cover (request-target), host, date, digest (missing: host, date)')
  })

  it('accepts injected algorithms, omitted algorithm, extra headers, and referenceTime', () => {
    const { privateKeyPem, publicKeyPem } = generateRsaSha256KeyPair()
    const { digestHeader, dateHeader } = digestAndDate()
    expect(
      verifySignature(
        verifyArgs(
          publicKeyPem,
          buildManualSignature({
            privateKeyPem,
            dateHeader,
            digestHeader,
            headerNames: FULL_HEADERS,
            algorithm: 'sha1',
          }),
          { digestHeader, dateHeader },
        ),
      ),
    ).toEqual({ valid: false, error: 'Unsupported signature algorithm: sha1' })
    expect(
      verifySignature(
        verifyArgs(
          publicKeyPem,
          buildManualSignature({
            privateKeyPem,
            dateHeader,
            digestHeader,
            headerNames: FULL_HEADERS,
            algorithm: 'hs2019',
          }),
          { digestHeader, dateHeader },
        ),
      ).valid,
    ).toBe(true)
    expect(
      verifySignature(
        verifyArgs(
          publicKeyPem,
          buildManualSignature({
            privateKeyPem,
            dateHeader,
            digestHeader,
            headerNames: FULL_HEADERS,
            algorithm: null,
          }),
          { digestHeader, dateHeader },
        ),
      ).valid,
    ).toBe(true)
    const contentType = 'application/activity+json'
    expect(
      verifySignature(
        verifyArgs(
          publicKeyPem,
          buildManualSignature({
            privateKeyPem,
            dateHeader,
            digestHeader,
            headerNames: [...FULL_HEADERS, 'content-type'],
            additionalHeaders: { 'content-type': contentType },
          }),
          { digestHeader, dateHeader, additionalHeaders: { 'content-type': contentType } },
        ),
      ).valid,
    ).toBe(true)
    expect(
      verifySignature(
        verifyArgs(
          publicKeyPem,
          buildManualSignature({
            privateKeyPem,
            dateHeader,
            digestHeader,
            headerNames: [...FULL_HEADERS, 'x-custom-header'],
            additionalHeaders: { 'x-custom-header': 'anything' },
          }),
          { digestHeader, dateHeader },
        ),
      ),
    ).toEqual({ valid: false, error: 'Unknown signed header: x-custom-header' })
    const receivedAt = new Date('2026-01-01T00:00:00.000Z')
    const receivedDate = new Date(receivedAt.getTime() - 30_000).toUTCString()
    expect(
      verifySignature(
        verifyArgs(
          publicKeyPem,
          buildManualSignature({
            privateKeyPem,
            dateHeader: receivedDate,
            digestHeader,
            headerNames: FULL_HEADERS,
          }),
          { digestHeader, dateHeader: receivedDate, referenceTime: receivedAt },
        ),
      ).valid,
    ).toBe(true)
  })

  it('rejects malformed PEM, signature headers, empty digest, and missing keyId', () => {
    const { publicKeyPem } = generateRsaSha256KeyPair()
    const { digestHeader, dateHeader } = digestAndDate()
    expect(
      verifySignature(
        verifyArgs(
          'not a public key pem',
          'headers="(request-target) host date digest",signature="abc"',
          { digestHeader, dateHeader },
        ),
      ),
    ).toEqual({
      valid: false,
      error: 'Signature verification exception: Invalid public key PEM format',
    })
    expect(
      verifySignature(
        verifyArgs(publicKeyPem, 'not a signature header at all', { digestHeader, dateHeader }),
      ),
    ).toEqual({ valid: false, error: 'Invalid signature header format' })
    expect(verifySignature(verifyArgs(publicKeyPem, '', { digestHeader, dateHeader }))).toEqual({
      valid: false,
      error: 'Invalid signature header format',
    })
    expect(
      verifySignature(
        verifyArgs(publicKeyPem, 'algorithm="rsa-sha256",signature="abc"', {
          digestHeader,
          dateHeader,
        }),
      ),
    ).toEqual({ valid: false, error: 'Invalid signature header format' })
    expect(
      verifySignature(
        verifyArgs(publicKeyPem, 'headers="(request-target) host date digest",signature="abc"', {
          digestHeader: '',
          dateHeader,
        }),
      ),
    ).toEqual({ valid: false, error: 'Digest verification failed' })
    expect(
      extractSignatureKeyId(
        `keyId="${KEY_ID}",algorithm="rsa-sha256",headers="(request-target) host date digest",signature="abc"`,
      ),
    ).toBe(KEY_ID)
    expect(
      extractSignatureKeyId('headers="(request-target) host date digest",signature="abc"'),
    ).toBeUndefined()
    expect(extractSignatureKeyId('')).toBeUndefined()
  })
})
