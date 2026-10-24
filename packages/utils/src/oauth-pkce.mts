function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCodePoint(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

/** 32 random bytes, base64url without padding (43 characters). */
export function generateCodeVerifier(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)))
}

/** 16 random bytes as 32 lowercase hex characters. */
export function generateState(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

/** RFC 7636 S256 code challenge for a verifier. */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64Url(new Uint8Array(hash))
}
