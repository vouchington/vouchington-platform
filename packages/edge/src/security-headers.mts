import { withHeaders } from './headers.mts'

export const DEFAULT_PERMISSIONS_POLICY = [
  'accelerometer',
  'attribution-reporting',
  'bluetooth',
  'browsing-topics',
  'camera',
  'display-capture',
  'gamepad',
  'geolocation',
  'gyroscope',
  'hid',
  'idle-detection',
  'interest-cohort',
  'join-ad-interest-group',
  'local-fonts',
  'magnetometer',
  'microphone',
  'midi',
  'payment',
  'run-ad-auction',
  'screen-wake-lock',
  'serial',
  'speaker-selection',
  'sync-xhr',
  'usb',
  'web-share',
  'xr-spatial-tracking',
]
  .map((feature) => `${feature}=()`)
  .join(', ')

export const BASE_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'SAMEORIGIN',
  'x-xss-protection': '0',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': DEFAULT_PERMISSIONS_POLICY,
  'origin-agent-cluster': '?1',
  'cross-origin-opener-policy': 'same-origin-allow-popups',
  'cross-origin-resource-policy': 'same-origin',
}

/** HSTS value. `preload` is effectively irreversible, so callers opt in explicitly. */
export function buildHsts(includePreload = false): string {
  return `max-age=63072000; includeSubDomains${includePreload ? '; preload' : ''}`
}

export type SecurityHeadersOptions = {
  /** Adds `strict-transport-security` when true. */
  production?: boolean
  hstsPreload?: boolean
  /** Final `content-security-policy` value; omitted for API-style responses. */
  csp?: string
  openerPolicy?: 'same-origin-allow-popups' | 'same-origin' | 'unsafe-none'
  /**
   * Honor an origin `referrer-policy: no-referrer` (only that value, only more restrictive).
   * The caller decides which routes carry URL credentials.
   */
  preserveOriginNoReferrer?: boolean
  /** Replaces the base header set. Defaults to {@link BASE_SECURITY_HEADERS}. */
  baseHeaders?: Readonly<Record<string, string>>
  /** Applied last, so callers can override any computed header. */
  overrides?: Readonly<Record<string, string>>
}

/** Returns the edge-authoritative security header set for one response. */
export function buildSecurityHeaders(
  response: Response,
  options: SecurityHeadersOptions = {},
): Record<string, string> {
  const headers: Record<string, string> = { ...(options.baseHeaders ?? BASE_SECURITY_HEADERS) }
  if (options.production) headers['strict-transport-security'] = buildHsts(options.hstsPreload)
  if (options.csp) headers['content-security-policy'] = options.csp
  if (options.openerPolicy) headers['cross-origin-opener-policy'] = options.openerPolicy
  // Headers.get() comma-joins repeats, so match any token; that can only tighten the policy.
  if (
    options.preserveOriginNoReferrer &&
    response.headers
      .get('referrer-policy')
      ?.split(',')
      .some((value) => value.trim().toLowerCase() === 'no-referrer')
  ) {
    headers['referrer-policy'] = 'no-referrer'
  }
  return { ...headers, ...options.overrides }
}

/** Overwrites response headers with {@link buildSecurityHeaders}, preserving `set-cookie`. */
export function addSecurityHeaders(
  response: Response,
  options: SecurityHeadersOptions = {},
): Response {
  return withHeaders(response, buildSecurityHeaders(response, options))
}
