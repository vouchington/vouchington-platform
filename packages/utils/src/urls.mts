const SCHEME = /^([a-z][a-z0-9+.-]*):/i
const LINK_SCHEMES = new Set(['http', 'https', 'mailto', 'tel'])
const IMAGE_SCHEMES = new Set(['http', 'https'])
export function extractUrlScheme(value: string): string | null {
  return value.match(SCHEME)?.[1]?.toLowerCase() ?? null
}
function sanitize(value: string | null | undefined, allowed: ReadonlySet<string>): string | null {
  const normalized = typeof value === 'string' ? value.trim() : ''
  // oxlint-disable-next-line no-control-regex -- reject URL-parser-normalized C0/DEL bypasses.
  if (!normalized || /[\u0000-\u001F\u007F]/.test(normalized)) return null
  const scheme = extractUrlScheme(normalized)
  if (!scheme && normalized.startsWith('//')) return null
  return !scheme || allowed.has(scheme) ? normalized : null
}
export function sanitizeLinkUrl(value: string | null | undefined): string | null {
  return sanitize(value, LINK_SCHEMES)
}
export function sanitizeImageUrl(value: string | null | undefined): string | null {
  return sanitize(value, IMAGE_SCHEMES)
}
export function isExternalHttpUrl(value: string | null | undefined): boolean {
  const sanitized = sanitizeLinkUrl(value)
  const scheme = sanitized ? extractUrlScheme(sanitized) : null
  return scheme === 'http' || scheme === 'https'
}
export function isAsciiHostname(value: string): boolean {
  return (
    Boolean(value) &&
    value.length <= 255 &&
    value.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
  )
}
export function normalizeAsciiHostname(value: string): string | null {
  const input = value
    .trim()
    .replace(
      /^(https?):\/+|^(https?):/i,
      (_match, first?: string, second?: string) => `${first ?? second}://`,
    )
  if (!input) return null
  try {
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`
    const authority = candidate.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i)?.[1]
    // oxlint-disable-next-line no-control-regex -- validate the authority before URL punycode conversion.
    if (!authority || /[^\x00-\x7F]/.test(authority)) return null
    const url = new URL(candidate)
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
    return !url.username && !url.password && hostname.length <= 255 && isAsciiHostname(hostname)
      ? hostname
      : null
  } catch {
    return null
  }
}

/** Normalizes ASCII or IDN hostnames, using WHATWG URL punycode conversion for Unicode input. */
export function normalizeHostname(value: string): string | null {
  const ascii = normalizeAsciiHostname(value)
  // oxlint-disable-next-line no-control-regex -- detect input requiring WHATWG punycode conversion.
  if (ascii !== null || !/[^\x00-\x7F]/.test(value)) return ascii
  const input = value
    .trim()
    .replace(
      /^(https?):\/+|^(https?):/i,
      (_match, first?: string, second?: string) => `${first ?? second}://`,
    )
  try {
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`
    const url = new URL(candidate)
    return url.username || url.password ? null : normalizeAsciiHostname(url.hostname)
  } catch {
    return null
  }
}

/** Removes one leading lowercase `www.` and trailing dots for presentation. */
export function formatHostnameForDisplay(hostname: string): string {
  return hostname.replace(/^www\./, '').replace(/\.+$/, '')
}
export function extractUrlHostname(value: string): string | null {
  try {
    return new URL(value).hostname || null
  } catch {
    return null
  }
}
export function getFirstPathSegment(pathname: string): string | null {
  if (pathname === '/') return null
  const index = pathname.indexOf('/', 1)
  return index < 0 ? '/' : pathname.slice(0, index)
}
export function matchesPathnamePattern(pathname: string, pattern: string): boolean {
  let pathIndex = 0
  let patternIndex = 0
  let wildcardPathIndex = -1
  let wildcardPatternIndex = -1
  while (pathIndex < pathname.length) {
    if (pattern[patternIndex] === '%') {
      wildcardPatternIndex = patternIndex++
      wildcardPathIndex = pathIndex
    } else if (pattern[patternIndex] === '_' || pattern[patternIndex] === pathname[pathIndex]) {
      pathIndex++
      patternIndex++
    } else if (wildcardPatternIndex >= 0) {
      patternIndex = wildcardPatternIndex + 1
      pathIndex = ++wildcardPathIndex
    } else return false
  }
  while (pattern[patternIndex] === '%') patternIndex++
  return patternIndex === pattern.length
}
/** Matches an ASCII hostname against exact patterns or an inclusive `*.` suffix pattern. */
export function matchesHostnamePattern(
  hostname: string,
  patterns: string | readonly string[],
): boolean {
  const candidate = hostname.toLowerCase()
  for (const configuredPattern of typeof patterns === 'string' ? [patterns] : patterns) {
    const pattern = configuredPattern.toLowerCase()
    if (pattern === candidate) return true
    if (
      pattern.startsWith('*.') &&
      (candidate === pattern.slice(2) || candidate.endsWith(pattern.slice(1)))
    )
      return true
  }
  return false
}
