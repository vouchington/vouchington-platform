export type CspDirectives = Record<string, readonly string[]>

export type CspOptions = {
  /** Per-request nonce; adds `'nonce-…'` to `script-src` when set. */
  nonce?: string
  /** `false` enables the development relaxations (`'unsafe-eval'`, `http:` images). */
  production?: boolean
  /** Static-asset origin (see {@link normalizeAssetOrigin}) added to script, style, img, font, connect. */
  assetOrigin?: string
  /** Extra sources appended to a directive, e.g. analytics or captcha origins. */
  sources?: Readonly<Record<string, readonly string[]>>
  /** Whole-directive replacements; `null` removes a directive. Applied before `sources`. */
  directives?: Readonly<Record<string, readonly string[] | null>>
}

export const DEFAULT_CSP_DIRECTIVES: Readonly<CspDirectives> = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'blob:', 'https:'],
  'font-src': ["'self'"],
  'frame-src': ["'self'"],
  'media-src': ["'self'", 'https:', 'blob:'],
  'connect-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
  'frame-ancestors': ["'self'"],
}

const ASSET_DIRECTIVES = ['script-src', 'style-src', 'img-src', 'font-src', 'connect-src']
const UNSAFE_SOURCE = /[\s;,]/u

/**
 * Normalizes an asset origin from configuration. Accepts `https:` origins and
 * `http://localhost`; strips path, query, and hash so a stray character cannot alter the policy.
 * Returns an empty string for absent or invalid values.
 */
export function normalizeAssetOrigin(raw?: string): string {
  const trimmed = raw?.trim() ?? ''
  if (!trimmed) return ''
  try {
    const url = new URL(trimmed)
    if (url.protocol === 'https:') return url.origin
    if (url.protocol === 'http:' && url.hostname === 'localhost') return url.origin
    return ''
  } catch {
    return ''
  }
}

/**
 * Parses a JSON array of exact HTTPS origins (for example upload hosts). Throws on any malformed,
 * duplicate, non-origin, or disallowed entry so a bad deployment value fails loudly.
 */
export function parseOriginAllowlist(
  raw: string | undefined,
  options: { isAllowedHostname?: (hostname: string) => boolean; label?: string } = {},
): string[] {
  const fail = (): never => {
    throw new Error(`${options.label ?? 'Origin allowlist'} must contain exact HTTPS origins`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw ?? '')
  } catch {
    return fail()
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return fail()
  const origins = parsed.map((value: unknown) => {
    if (typeof value !== 'string') return fail()
    try {
      const url = new URL(value)
      const allowed = options.isAllowedHostname?.(url.hostname) ?? true
      if (url.protocol === 'https:' && url.origin === value && allowed) return value
    } catch {
      return fail()
    }
    return fail()
  })
  if (new Set(origins).size !== origins.length) return fail()
  return origins
}

/** Serializes directives as a header value, rejecting sources that could inject a directive. */
export function serializeCsp(directives: Readonly<Record<string, readonly string[]>>): string {
  return Object.entries(directives)
    .map(([name, sources]) => {
      for (const source of sources) {
        if (!source || UNSAFE_SOURCE.test(source)) {
          throw new Error(`Invalid CSP source in ${name}: ${JSON.stringify(source)}`)
        }
      }
      return [name, ...sources].join(' ')
    })
    .join('; ')
}

/** Builds a nonce-based CSP from safe defaults plus injected origins. */
export function buildCsp(options: CspOptions = {}): string {
  const directives: Record<string, string[]> = {}
  for (const [name, sources] of Object.entries(DEFAULT_CSP_DIRECTIVES))
    directives[name] = [...sources]
  const add = (name: string, extra: readonly string[]) => {
    directives[name] = [...(directives[name] ?? []), ...extra]
  }
  if (options.nonce) add('script-src', [`'nonce-${options.nonce}'`])
  if (options.production === false) {
    add('script-src', ["'unsafe-eval'"])
    add('img-src', ['http:'])
  }
  const assetOrigin = normalizeAssetOrigin(options.assetOrigin)
  if (assetOrigin) for (const name of ASSET_DIRECTIVES) add(name, [assetOrigin])
  for (const [name, replacement] of Object.entries(options.directives ?? {})) {
    if (replacement === null) delete directives[name]
    else directives[name] = [...replacement]
  }
  for (const [name, extra] of Object.entries(options.sources ?? {})) add(name, extra)
  return serializeCsp(directives)
}
