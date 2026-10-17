import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto'

import { decodeBase64Url, decodeVapidPublicKey, encodeBase64Url } from './web-push.mts'

export interface VapidKeyPair {
  /** Uncompressed P-256 point, base64url (the browser `applicationServerKey`). */
  publicKey: string
  /** Raw 32-byte private scalar, base64url. */
  privateKey: string
}

export interface VapidJwtInput {
  keys: VapidKeyPair
  /** Push service origin, for example `getPushServiceAudience(endpoint)`. */
  audience: string
  /** `mailto:` or `https:` contact URI. */
  subject: string
  /** Seconds since epoch; injectable for tests. */
  now?: number
  /** Lifetime in seconds; RFC 8292 caps it at 24 hours. */
  expiresInSeconds?: number
}

const MAX_VAPID_LIFETIME_SECONDS = 24 * 60 * 60

export function generateVapidKeys(): VapidKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const pub = publicKey.export({ format: 'jwk' })
  const priv = privateKey.export({ format: 'jwk' })
  const point = new Uint8Array([
    0x04,
    ...decodeBase64Url(pub.x as string),
    ...decodeBase64Url(pub.y as string),
  ])
  return { publicKey: encodeBase64Url(point), privateKey: priv.d as string }
}

function toPrivateKey({ publicKey, privateKey }: VapidKeyPair) {
  const point = decodeVapidPublicKey(publicKey)
  return createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: encodeBase64Url(point.slice(1, 33)),
      y: encodeBase64Url(point.slice(33)),
      d: privateKey,
    },
    format: 'jwk',
  })
}

/** Returns whether the private scalar corresponds to the public point. */
export function vapidKeysMatch(keys: VapidKeyPair): boolean {
  try {
    // Sign/verify rather than comparing exported points: some Node/OpenSSL builds keep the
    // imported public coordinates instead of deriving them from the private scalar.
    const point = decodeVapidPublicKey(keys.publicKey)
    const publicKey = createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: encodeBase64Url(point.slice(1, 33)),
        y: encodeBase64Url(point.slice(33)),
      },
      format: 'jwk',
    })
    const probe = Buffer.from('vapid-key-check')
    const signature = sign('sha256', probe, toPrivateKey(keys))
    return verify('sha256', probe, publicKey, signature)
  } catch {
    return false
  }
}

/** Signs an ES256 VAPID JWT (RFC 8292). */
export function createVapidJwt(input: VapidJwtInput): string {
  const lifetime = input.expiresInSeconds ?? MAX_VAPID_LIFETIME_SECONDS
  if (!(lifetime > 0) || lifetime > MAX_VAPID_LIFETIME_SECONDS) {
    throw new RangeError('VAPID JWT lifetime must be between 1 second and 24 hours')
  }
  if (!/^(mailto:|https:\/\/)/.test(input.subject)) {
    throw new TypeError('VAPID subject must be a mailto: or https: URI')
  }
  const now = input.now ?? Math.floor(Date.now() / 1000)
  const encode = (value: object) => encodeBase64Url(new TextEncoder().encode(JSON.stringify(value)))
  const signingInput = `${encode({ typ: 'JWT', alg: 'ES256' })}.${encode({
    aud: input.audience,
    exp: now + lifetime,
    sub: input.subject,
  })}`
  const signature = sign('sha256', Buffer.from(signingInput), {
    key: toPrivateKey(input.keys),
    dsaEncoding: 'ieee-p1363',
  })
  return `${signingInput}.${encodeBase64Url(signature)}`
}

/** Builds the `Authorization` header value for the `vapid` scheme. */
export function createVapidAuthorization(jwt: string, publicKey: string): string {
  decodeVapidPublicKey(publicKey)
  return `vapid t=${jwt}, k=${publicKey}`
}
