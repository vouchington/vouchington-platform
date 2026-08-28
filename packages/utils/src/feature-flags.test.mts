import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FEATURE_FLAG_COOKIE_MAX_LENGTH,
  encodeFeatureFlagCookie,
  extractBooleanFeatureFlags,
  parseFeatureFlagCookie,
  parseFeatureFlagCookieMaxLength,
  safeFeatureFlagCookiePart,
} from './feature-flags.mts'

const codec = {
  decodeBase64: (value: string) => Buffer.from(value, 'base64').toString('utf8'),
  encodeBase64: (value: string) => Buffer.from(value).toString('base64'),
}

describe('feature flag cookies', () => {
  it('round-trips boolean feature flags through an injected codec', () => {
    const encoded = encodeFeatureFlagCookie({ enabled: true, disabled: false }, codec)
    expect(parseFeatureFlagCookie(encoded, codec)).toEqual({ enabled: true, disabled: false })
    expect(safeFeatureFlagCookiePart('caller-flags', encoded)).toBe(`caller-flags=${encoded}`)
  })

  it('retains only boolean own fields', () => {
    expect(extractBooleanFeatureFlags({ enabled: true, disabled: false, other: 1 })).toEqual({
      enabled: true,
      disabled: false,
    })
    expect(
      parseFeatureFlagCookie(
        codec.encodeBase64(JSON.stringify({ enabled: true, other: 1 })),
        codec,
      ),
    ).toEqual({ enabled: true })
  })

  it('preserves boolean __proto__ fields as prototype-safe own properties', () => {
    const flags = extractBooleanFeatureFlags(
      JSON.parse('{"__proto__":true}') as Record<string, unknown>,
    )
    expect(Object.getPrototypeOf(flags)).toBe(Object.prototype)
    expect(Object.getOwnPropertyDescriptor(flags, '__proto__')).toMatchObject({
      configurable: true,
      enumerable: true,
      value: true,
      writable: true,
    })
  })

  it('accepts unpadded base64 JSON payloads', () => {
    const encoded = codec.encodeBase64('{"enabled":true}').replace(/=+$/, '')
    expect(parseFeatureFlagCookie(encoded, codec)).toEqual({ enabled: true })
  })

  it.each(['null', '[]', '"string"', '1', '{'])(
    'rejects non-object or malformed decoded JSON %j',
    (decoded) => {
      expect(parseFeatureFlagCookie(codec.encodeBase64(decoded), codec)).toEqual({})
    },
  )

  it('fails closed for malformed values and a throwing codec before accepting flags', () => {
    const throwingCodec = {
      ...codec,
      decodeBase64: () => {
        throw new Error('bad decode')
      },
    }
    expect(parseFeatureFlagCookie('', codec)).toEqual({})
    expect(parseFeatureFlagCookie('not base64!', codec)).toEqual({})
    expect(parseFeatureFlagCookie('a===', codec)).toEqual({})
    expect(parseFeatureFlagCookie(codec.encodeBase64('{"enabled":true}'), throwingCodec)).toEqual(
      {},
    )
  })

  it('rejects oversized encoded values before invoking the decoder', () => {
    let decoded = false
    expect(
      parseFeatureFlagCookie(
        'AAAA',
        {
          ...codec,
          decodeBase64: () => {
            decoded = true
            return '{}'
          },
        },
        { maxCookieLength: 3 },
      ),
    ).toEqual({})
    expect(decoded).toBe(false)
  })

  it('parses only positive safe-integer max-length overrides', () => {
    expect(parseFeatureFlagCookieMaxLength('12px')).toBe(12)
    expect(parseFeatureFlagCookieMaxLength('0')).toBe(DEFAULT_FEATURE_FLAG_COOKIE_MAX_LENGTH)
    expect(parseFeatureFlagCookieMaxLength('-1')).toBe(DEFAULT_FEATURE_FLAG_COOKIE_MAX_LENGTH)
    expect(parseFeatureFlagCookieMaxLength(String(Number.MAX_SAFE_INTEGER + 1), 7)).toBe(7)
    expect(parseFeatureFlagCookieMaxLength(undefined, 7)).toBe(7)
  })

  it('supports Unicode payloads through the injected codec', () => {
    const encoded = encodeFeatureFlagCookie({ 'd\u00e9j\u00e0-vu': true }, codec)
    expect(parseFeatureFlagCookie(encoded, codec)).toEqual({ 'd\u00e9j\u00e0-vu': true })
  })

  it.each([
    ['', 'value'],
    ['bad name', 'value'],
    ['bad=name', 'value'],
    ['bad;name', 'value'],
    ['name', ''],
    ['name', 'not base64!'],
    ['name', 'AAAA'],
  ])('rejects unsafe cookie part %j=%j', (name, value) => {
    const options = value === 'AAAA' ? { maxCookieLength: 3 } : undefined
    expect(safeFeatureFlagCookiePart(name, value, options)).toBeNull()
  })
})
