import { createPrivateKey, sign } from 'node:crypto'
import { computeDigest } from './http-signatures-digest.mts'
import { assertPrivateKeyPem } from './http-signatures-keys.mts'
import { buildSigningString, isSha256SignatureAlgorithm } from './http-signatures-string.mts'

export type SignatureHeaders = {
  digest: string
  signature: string
  date: string
}

export type BuildSignatureHeadersOptions = {
  method: string
  url: string
  body: string | Buffer
  keyId: string
  privateKeyPem: string
  signedHeaders: readonly string[]
  algorithm: string
  now?: Date
  additionalHeaders?: Record<string, string>
}

export function buildSignatureHeaders(options: BuildSignatureHeadersOptions): SignatureHeaders {
  if (options.signedHeaders.length === 0) throw new Error('signedHeaders must not be empty')
  if (!isSha256SignatureAlgorithm(options.algorithm)) {
    throw new Error(`Unsupported signature algorithm: ${options.algorithm}`)
  }
  assertPrivateKeyPem(options.privateKeyPem)

  const digest = computeDigest(options.body)
  const date = (options.now ?? new Date()).toUTCString()
  const url = new URL(options.url)
  const host = url.host
  const path = url.pathname + url.search
  const signingString = buildSigningString(options.signedHeaders, {
    method: options.method,
    path,
    host,
    date,
    digest,
    additionalHeaders: options.additionalHeaders,
  })
  if (typeof signingString !== 'string') throw new Error(signingString.error)

  const signature = sign(
    'sha256',
    Buffer.from(signingString),
    createPrivateKey(options.privateKeyPem),
  ).toString('base64')
  const signatureHeaderValue = [
    `keyId="${options.keyId}"`,
    `algorithm="${options.algorithm}"`,
    `headers="${options.signedHeaders.map((name) => name.toLowerCase()).join(' ')}"`,
    `signature="${signature}"`,
  ].join(',')
  return { digest, signature: signatureHeaderValue, date }
}
