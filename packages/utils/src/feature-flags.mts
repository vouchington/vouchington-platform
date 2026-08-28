export type FeatureFlags = Record<string, boolean>

export type FeatureFlagCookieCodec = {
  encodeBase64(value: string): string
  decodeBase64(value: string): string
}

export type FeatureFlagCookieOptions = {
  maxCookieLength?: number
}

export const DEFAULT_FEATURE_FLAG_COOKIE_MAX_LENGTH = 4096

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/
const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

export function extractBooleanFeatureFlags(fields: Record<string, unknown>): FeatureFlags {
  const flags: FeatureFlags = {}
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === 'boolean') {
      Object.defineProperty(flags, key, {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
      })
    }
  }
  return flags
}

export function parseFeatureFlagCookie(
  cookieValue: string,
  codec: FeatureFlagCookieCodec,
  options: FeatureFlagCookieOptions = {},
): FeatureFlags {
  try {
    if (!isSafeCookieValue(cookieValue, options)) return {}
    const parsed: unknown = JSON.parse(codec.decodeBase64(cookieValue))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return extractBooleanFeatureFlags(parsed as Record<string, unknown>)
  } catch {
    return {}
  }
}

export function encodeFeatureFlagCookie(
  overrides: FeatureFlags,
  codec: FeatureFlagCookieCodec,
): string {
  return codec.encodeBase64(JSON.stringify(overrides))
}

export function parseFeatureFlagCookieMaxLength(
  value: string | undefined,
  fallback = DEFAULT_FEATURE_FLAG_COOKIE_MAX_LENGTH,
): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function safeFeatureFlagCookiePart(
  cookieName: string,
  cookieValue: string | undefined,
  options: FeatureFlagCookieOptions = {},
): string | null {
  return COOKIE_NAME.test(cookieName) && isSafeCookieValue(cookieValue, options)
    ? `${cookieName}=${cookieValue}`
    : null
}

function isSafeCookieValue(
  value: string | undefined,
  { maxCookieLength = DEFAULT_FEATURE_FLAG_COOKIE_MAX_LENGTH }: FeatureFlagCookieOptions,
): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxCookieLength &&
    BASE64.test(value)
  )
}
