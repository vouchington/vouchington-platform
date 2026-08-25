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
  return Boolean(value) && /^[a-z0-9.-]+$/i.test(value)
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
