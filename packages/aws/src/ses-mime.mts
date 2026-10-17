import { randomUUID } from 'node:crypto'

export interface RawEmailOptions {
  source: string
  to: string | readonly string[]
  replyTo?: string | readonly string[] | undefined
  subject: string
  text?: string | undefined
  html?: string | undefined
  headers?: Readonly<Record<string, string>> | undefined
  boundaryPrefix?: string
  boundary?: string
}

function list(value: string | readonly string[]): string[] {
  return typeof value === 'string' ? [value] : [...value]
}

function assertSafe(label: string, value: string): string {
  if (/[\r\n]/.test(value)) throw new TypeError(`${label} must not contain line breaks`)
  return value
}

// RFC 2046 boundary grammar without the trailing-space allowance.
const BOUNDARY = /^[0-9A-Za-z'()+_,\-./:=?]{1,70}$/

// Folds an address list across lines so no header line nears the 998-character limit.
function addressHeader(name: string, value: string | readonly string[]): string {
  const addresses = list(value).map((address) => assertSafe(name, address))
  return `${name}: ${addresses.join(',\r\n ')}`
}

function normalizeCrLf(value: string): string {
  return value.replace(/\r\n|\r|\n/g, '\r\n')
}

function encodeMimeBody(value: string): string {
  const encoded = Buffer.from(normalizeCrLf(value), 'utf8').toString('base64')
  return (encoded.match(/.{1,76}/g) ?? ['']).join('\r\n')
}

function encodeHeaderValue(value: string): string {
  return /^[\x20-\x7E]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`
}

// Builds a base64-encoded RFC 5322 message, preserving caller headers such as List-Unsubscribe.
// Header names and values containing CR or LF are rejected to prevent header injection.
export function buildRawEmailMessage(options: RawEmailOptions): string {
  const headers = [
    `From: ${assertSafe('source', options.source)}`,
    addressHeader('To', options.to),
    ...(options.replyTo ? [addressHeader('Reply-To', options.replyTo)] : []),
    `Subject: ${encodeHeaderValue(assertSafe('subject', options.subject))}`,
    'MIME-Version: 1.0',
    ...Object.entries(options.headers ?? {}).map(
      ([name, value]) => `${assertSafe('header name', name)}: ${assertSafe('header value', value)}`,
    ),
  ]

  if (options.text && options.html) {
    const boundary = options.boundary ?? `${options.boundaryPrefix ?? 'mime'}-${randomUUID()}`
    if (!BOUNDARY.test(boundary)) throw new TypeError('Invalid MIME boundary')
    const part = (type: string, body: string) => [
      `--${boundary}`,
      `Content-Type: ${type}; charset=UTF-8`,
      'Content-Transfer-Encoding: base64',
      '',
      encodeMimeBody(body),
      '',
    ]
    return [
      ...headers,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      ...part('text/plain', options.text),
      ...part('text/html', options.html),
      `--${boundary}--`,
      '',
    ].join('\r\n')
  }

  const contentType = options.html ? 'text/html' : 'text/plain'
  return [
    ...headers,
    `Content-Type: ${contentType}; charset=UTF-8`,
    'Content-Transfer-Encoding: base64',
    '',
    encodeMimeBody(options.html ?? options.text ?? ''),
  ].join('\r\n')
}
