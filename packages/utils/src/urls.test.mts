import { describe, expect, it } from 'vitest'
import {
  extractUrlHostname,
  extractUrlScheme,
  getFirstPathSegment,
  isAsciiHostname,
  isExternalHttpUrl,
  matchesPathnamePattern,
  normalizeAsciiHostname,
  sanitizeImageUrl,
  sanitizeLinkUrl,
} from './urls.mts'

describe('URLs', () => {
  it('sanitizes explicitly allowed URI schemes', () => {
    expect(extractUrlScheme('HTTPS://example.test')).toBe('https')
    expect(extractUrlScheme('example.test')).toBeNull()
    expect(sanitizeLinkUrl(' javascript:alert(1) ')).toBeNull()
    expect(sanitizeLinkUrl('/relative')).toBe('/relative')
    expect(sanitizeImageUrl('mailto:a@example.test')).toBeNull()
    expect(isExternalHttpUrl('https://example.test')).toBe(true)
    expect(isExternalHttpUrl('tel:+1')).toBe(false)
    expect(isExternalHttpUrl(null)).toBe(false)
  })

  it('normalizes ASCII hostnames and returns null for invalid URLs', () => {
    expect(isAsciiHostname('example.com')).toBe(true)
    expect(isAsciiHostname('café.test')).toBe(false)
    expect(normalizeAsciiHostname('HTTP:/Example.com.:8080/path')).toBe('example.com')
    expect(normalizeAsciiHostname('https:example.com')).toBe('example.com')
    expect(normalizeAsciiHostname('user@example.test')).toBeNull()
    expect(normalizeAsciiHostname('')).toBeNull()
    expect(normalizeAsciiHostname('http://[')).toBeNull()
    expect(extractUrlHostname('https://example.test/path')).toBe('example.test')
    expect(extractUrlHostname('mailto:a@example.test')).toBeNull()
    expect(extractUrlHostname('not a url')).toBeNull()
  })

  it('handles pathname groups and SQL-like matching', () => {
    expect(getFirstPathSegment('/blog/2026/a')).toBe('/blog')
    expect(getFirstPathSegment('/about')).toBe('/')
    expect(getFirstPathSegment('/')).toBeNull()
    expect(matchesPathnamePattern('/blog/a', '/blog/%')).toBe(true)
    expect(matchesPathnamePattern('', '%')).toBe(true)
    expect(matchesPathnamePattern('/blog/a', '/blog/_')).toBe(true)
    expect(matchesPathnamePattern('/blog/ab', '/blog/_')).toBe(false)
  })
})
