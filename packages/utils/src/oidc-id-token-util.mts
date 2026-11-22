/**
 * Rejects with the signal's reason when it aborts; the underlying promise keeps running.
 * An already-aborted signal rejects at once, and the abandoned promise gets a no-op handler so
 * a later failure is not an unhandled rejection.
 */
export function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) {
    promise.catch(() => undefined)
    return Promise.reject(signal.reason as Error)
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason as Error)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.finally(() => signal.removeEventListener('abort', onAbort)).then(resolve, reject)
  })
}

/** Decodes base64url with Web APIs only; throws on invalid input. */
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/'))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Verifies an RSASSA-PKCS1-v1_5 SHA-256 signature against a JWK public key. */
export async function verifyRs256(
  key: { kty: string; n: string; e: string },
  signed: string,
  signature: Uint8Array<ArrayBuffer>,
): Promise<boolean> {
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    { kty: key.kty, n: key.n, e: key.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  return crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    publicKey,
    signature,
    new TextEncoder().encode(signed),
  )
}
