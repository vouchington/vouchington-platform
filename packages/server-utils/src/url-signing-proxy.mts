import { signPath } from './url-signing-keys.mts'

export type BuildSignedProxyUrlOptions = {
  /** Origin that serves the proxy route. */
  origin: string
  /** Route prefix; the base64url target is appended, e.g. `/proxy/v1/`. */
  pathPrefix: string
  /** Ordered query parameters; undefined values are skipped. The signature is appended last. */
  query?: Record<string, string | number | undefined>
  signingKeys: readonly string[]
  /** Return true to leave a URL unproxied (first-party hosts, legacy routes, ...). */
  skip?: (url: URL) => boolean
  /** Name of the signature query parameter. Defaults to `sig`. */
  signatureParam?: string
}

/**
 * Build a signed proxy URL for an external http(s) URL. Returns null for empty, relative,
 * protocol-relative, non-http(s), already-proxied, or caller-skipped URLs. When no key is usable
 * the URL is returned without a signature.
 */
export function buildSignedProxyUrl(
  externalUrl: string,
  options: BuildSignedProxyUrlOptions,
): string | null {
  const value = externalUrl.trim()
  if (!value || value.startsWith('//')) return null
  let target: URL
  try {
    target = new URL(value)
  } catch {
    return null
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return null
  const origin = new URL(options.origin).origin
  if (target.origin === origin && target.pathname.startsWith(options.pathPrefix)) return null
  if (options.skip?.(target)) return null

  const path = `${options.pathPrefix}${Buffer.from(value, 'utf8').toString('base64url')}`
  const params = new URLSearchParams()
  for (const [name, entry] of Object.entries(options.query ?? {})) {
    if (entry !== undefined) params.append(name, String(entry))
  }
  const signature = signPath(path, options.signingKeys)
  if (signature) params.append(options.signatureParam ?? 'sig', signature)
  const query = params.toString()
  return `${origin}${path}${query ? `?${query}` : ''}`
}
