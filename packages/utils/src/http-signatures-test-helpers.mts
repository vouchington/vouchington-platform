import { createPrivateKey, sign as cryptoSign } from 'node:crypto'
import { computeDigest } from './http-signatures-digest.mts'
import type { VerifySignatureOptions } from './http-signatures-verify.mts'

export const KEY_ID = 'https://example.test/users/alice#main-key'
const METHOD = 'POST'
const PATH = '/inbox'
const HOST = 'mastodon.example'
export const BODY = JSON.stringify({ type: 'Follow', object: 'https://example.test' })
export const FULL_HEADERS = ['(request-target)', 'host', 'date', 'digest'] as const
const ALLOWED_ALGORITHMS = ['rsa-sha256', 'hs2019'] as const
const MAX_AGE_SECONDS = 3600

export const defaultVerifyPolicy = {
  requiredHeaders: FULL_HEADERS,
  allowedAlgorithms: ALLOWED_ALGORITHMS,
  maxAgeSeconds: MAX_AGE_SECONDS,
} as const

export const defaultSignPolicy = {
  signedHeaders: FULL_HEADERS,
  algorithm: 'rsa-sha256',
} as const

export function digestAndDate(body: string | Buffer = BODY): {
  digestHeader: string
  dateHeader: string
} {
  return { digestHeader: computeDigest(body), dateHeader: new Date().toUTCString() }
}

export function verifyArgs(
  publicKeyPem: string,
  signatureHeader: string,
  extras: Partial<VerifySignatureOptions> = {},
): VerifySignatureOptions {
  const { digestHeader, dateHeader } = digestAndDate(extras.body ?? BODY)
  return {
    method: METHOD,
    path: PATH,
    host: HOST,
    body: BODY,
    signatureHeader,
    digestHeader,
    dateHeader,
    publicKeyPem,
    ...defaultVerifyPolicy,
    ...extras,
  }
}

export function buildManualSignature(options: {
  privateKeyPem: string
  dateHeader: string
  digestHeader: string
  headerNames: readonly string[]
  additionalHeaders?: Record<string, string>
  keyId?: string
  algorithm?: string | null
  method?: string
  path?: string
  host?: string
}): string {
  const headerNames = options.headerNames
  const signingString = headerNames
    .map((name) => {
      if (name === '(request-target)') {
        return `(request-target): ${(options.method ?? METHOD).toLowerCase()} ${options.path ?? PATH}`
      }
      if (name === 'host') return `host: ${options.host ?? HOST}`
      if (name === 'date') return `date: ${options.dateHeader}`
      if (name === 'digest') return `digest: ${options.digestHeader}`
      return `${name}: ${options.additionalHeaders?.[name]}`
    })
    .join('\n')
  const signature = cryptoSign(
    'sha256',
    Buffer.from(signingString),
    createPrivateKey(options.privateKeyPem),
  ).toString('base64')
  const headerParts = [`keyId="${options.keyId ?? KEY_ID}"`]
  if (options.algorithm !== null) {
    headerParts.push(`algorithm="${options.algorithm ?? 'rsa-sha256'}"`)
  }
  headerParts.push(`headers="${headerNames.join(' ')}"`)
  headerParts.push(`signature="${signature}"`)
  return headerParts.join(',')
}
