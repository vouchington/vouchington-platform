export interface WebPushSubscriptionJson {
  endpoint: string
  expirationTime: number | null
  keys: { p256dh: string; auth: string }
}

export interface WebPushSubscriptionOptions {
  /** Extra endpoint policy, for example a push-service host allowlist. Defaults to any https URL. */
  allowEndpoint?: (url: URL) => boolean
  maxEndpointLength?: number
}

export interface WebPushPayload {
  title: string
  body?: string
  url?: string
  icon?: string
  tag?: string
  data?: Record<string, unknown>
}

/** RFC 8291 section 4: the largest plaintext every push service must accept (4096 - 103). */
export const MAX_WEB_PUSH_PAYLOAD_BYTES = 3993
const P256DH_BYTES = 65
const AUTH_BYTES = 16

/** Decodes unpadded or padded base64url; throws TypeError on invalid characters. */
export function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*={0,2}$/.test(value)) throw new TypeError('Invalid base64url string')
  const base64 = value.replace(/=+$/, '').replaceAll('-', '+').replaceAll('_', '/')
  if (base64.length % 4 === 1) throw new TypeError('Invalid base64url string')
  return Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')), (c) =>
    c.charCodeAt(0),
  )
}

export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

/** Validates a VAPID public key (uncompressed P-256 point) and returns `applicationServerKey` bytes. */
export function decodeVapidPublicKey(key: string): Uint8Array {
  const bytes = decodeBase64Url(key)
  if (bytes.length !== P256DH_BYTES || bytes[0] !== 0x04) {
    throw new TypeError('VAPID public key must be an uncompressed P-256 point')
  }
  return bytes
}

export function getPushServiceAudience(endpoint: string): string {
  return new URL(endpoint).origin
}

function keyOfLength(value: unknown, length: number, name: string): string {
  if (typeof value !== 'string') throw new TypeError(`Push subscription ${name} must be a string`)
  if (decodeBase64Url(value).length !== length) {
    throw new TypeError(`Push subscription ${name} has an invalid length`)
  }
  return value
}

/** Validates the JSON shape of `PushSubscription.toJSON()`; throws TypeError when invalid. */
export function parseWebPushSubscription(
  value: unknown,
  options: WebPushSubscriptionOptions = {},
): WebPushSubscriptionJson {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('Push subscription must be an object')
  }
  const { endpoint, expirationTime, keys } = value as Record<string, unknown>
  if (typeof endpoint !== 'string' || endpoint.length > (options.maxEndpointLength ?? 2048)) {
    throw new TypeError('Push subscription endpoint is invalid')
  }
  const url = URL.parse(endpoint)
  if (!url || url.protocol !== 'https:' || (options.allowEndpoint && !options.allowEndpoint(url))) {
    throw new TypeError('Push subscription endpoint is not allowed')
  }
  if (expirationTime != null && (typeof expirationTime !== 'number' || !(expirationTime >= 0))) {
    throw new TypeError('Push subscription expirationTime is invalid')
  }
  if (typeof keys !== 'object' || keys === null) {
    throw new TypeError('Push subscription keys are required')
  }
  const { p256dh, auth } = keys as Record<string, unknown>
  return {
    endpoint,
    expirationTime: expirationTime ?? null,
    keys: {
      p256dh: keyOfLength(p256dh, P256DH_BYTES, 'p256dh'),
      auth: keyOfLength(auth, AUTH_BYTES, 'auth'),
    },
  }
}

export function isWebPushSubscription(
  value: unknown,
  options?: WebPushSubscriptionOptions,
): value is WebPushSubscriptionJson {
  try {
    parseWebPushSubscription(value, options)
    return true
  } catch {
    return false
  }
}

/** Serializes a payload to UTF-8 JSON bytes, rejecting payloads over `maxBytes`. */
export function buildWebPushPayload(
  payload: WebPushPayload,
  maxBytes: number = MAX_WEB_PUSH_PAYLOAD_BYTES,
): Uint8Array {
  if (!payload.title) throw new TypeError('Push payload title is required')
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  if (bytes.length > maxBytes) throw new RangeError(`Push payload exceeds ${maxBytes} bytes`)
  return bytes
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

/** Parses payload text inside a service worker; returns null for anything malformed. */
export function parseWebPushPayload(text: string): WebPushPayload | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const record = parsed as Record<string, unknown>
  const title = optionalString(record.title)
  if (!title) return null
  const { data } = record
  const isData = typeof data === 'object' && data !== null && !Array.isArray(data)
  return {
    title,
    ...(optionalString(record.body) ? { body: record.body as string } : {}),
    ...(optionalString(record.url) ? { url: record.url as string } : {}),
    ...(optionalString(record.icon) ? { icon: record.icon as string } : {}),
    ...(optionalString(record.tag) ? { tag: record.tag as string } : {}),
    ...(isData ? { data: data as Record<string, unknown> } : {}),
  }
}
