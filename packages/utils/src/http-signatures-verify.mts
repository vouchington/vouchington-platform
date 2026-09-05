import { verify } from 'node:crypto'
import { verifyDigest } from './http-signatures-digest.mts'
import { assertPublicKeyPem } from './http-signatures-keys.mts'
import { buildSigningString } from './http-signatures-string.mts'

export type VerifySignatureOptions = {
  method: string
  path: string
  host: string
  body: string | Buffer
  signatureHeader: string
  digestHeader: string
  dateHeader: string
  publicKeyPem: string
  requiredHeaders: readonly string[]
  allowedAlgorithms: readonly string[]
  maxAgeSeconds: number
  additionalHeaders?: Record<string, string>
  referenceTime?: Date
}

export type SignatureVerificationResult = {
  valid: boolean
  error?: string
}

const SIGNATURE_VALUE_PATTERN = /signature="([^"]+)"/
const HEADERS_VALUE_PATTERN = /headers="([^"]+)"/
const ALGORITHM_VALUE_PATTERN = /algorithm="([^"]+)"/
const KEY_ID_VALUE_PATTERN = /keyId="([^"]+)"/

export function extractSignatureKeyId(signatureHeader: string): string | undefined {
  return KEY_ID_VALUE_PATTERN.exec(signatureHeader)?.[1]
}

function parseSignatureHeader(
  header: string,
): { signature: string; headers: string[]; algorithm: string | null } | null {
  const signatureMatch = SIGNATURE_VALUE_PATTERN.exec(header)
  const headersMatch = HEADERS_VALUE_PATTERN.exec(header)
  if (!signatureMatch?.[1] || !headersMatch?.[1]) return null
  return {
    signature: signatureMatch[1],
    headers: headersMatch[1].split(' ').map((name) => name.toLowerCase()),
    algorithm: ALGORITHM_VALUE_PATTERN.exec(header)?.[1] ?? null,
  }
}

export function verifySignature(options: VerifySignatureOptions): SignatureVerificationResult {
  try {
    return verifySignatureBody(options)
  } catch (err) {
    return {
      valid: false,
      error: `Signature verification exception: ${(err as Error).message}`,
    }
  }
}

function verifySignatureBody(options: VerifySignatureOptions): SignatureVerificationResult {
  assertPublicKeyPem(options.publicKeyPem)
  const requestDate = new Date(options.dateHeader)
  if (Number.isNaN(requestDate.getTime())) return { valid: false, error: 'Invalid date header' }
  const ageSeconds =
    ((options.referenceTime?.getTime() ?? Date.now()) - requestDate.getTime()) / 1000
  if (Math.abs(ageSeconds) > options.maxAgeSeconds) {
    return {
      valid: false,
      error: `Date header too old: ${ageSeconds}s > ${options.maxAgeSeconds}s`,
    }
  }
  if (!verifyDigest(options.body, options.digestHeader)) {
    return { valid: false, error: 'Digest verification failed' }
  }
  const sigParts = parseSignatureHeader(options.signatureHeader)
  if (!sigParts) return { valid: false, error: 'Invalid signature header format' }
  const { signature, headers, algorithm } = sigParts
  if (algorithm !== null && !options.allowedAlgorithms.includes(algorithm)) {
    return { valid: false, error: `Unsupported signature algorithm: ${algorithm}` }
  }
  const covered = new Set(headers)
  const missingRequired = options.requiredHeaders
    .map((name) => name.toLowerCase())
    .filter((name) => !covered.has(name))
  if (missingRequired.length > 0) {
    return {
      valid: false,
      error: `Signature must cover ${options.requiredHeaders.join(', ')} (missing: ${missingRequired.join(', ')})`,
    }
  }
  const signingString = buildSigningString(headers, {
    method: options.method,
    path: options.path,
    host: options.host,
    date: options.dateHeader,
    digest: options.digestHeader,
    additionalHeaders: options.additionalHeaders,
  })
  if (typeof signingString !== 'string') return { valid: false, error: signingString.error }
  const isValid = verify(
    'sha256',
    Buffer.from(signingString),
    options.publicKeyPem,
    Buffer.from(signature, 'base64'),
  )
  return isValid ? { valid: true } : { valid: false, error: 'Signature verification failed' }
}
