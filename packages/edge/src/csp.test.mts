import { describe, expect, it } from 'vitest'
import { buildCsp, normalizeAssetOrigin, parseOriginAllowlist, serializeCsp } from './csp.mts'

const directive = (csp: string, name: string) =>
  csp.split('; ').find((part) => part.startsWith(`${name} `))

describe('normalizeAssetOrigin', () => {
  it.each([
    [undefined, ''],
    ['  ', ''],
    ['https://cdn.example.com/path?x=1#h', 'https://cdn.example.com'],
    ['http://localhost:3000/assets', 'http://localhost:3000'],
    ['http://cdn.example.com', ''],
    ['ftp://cdn.example.com', ''],
    ['not a url', ''],
  ])('normalizes %s', (raw, expected) => {
    expect(normalizeAssetOrigin(raw)).toBe(expected)
  })
})

describe('parseOriginAllowlist', () => {
  const origins = ['https://a.example.com', 'https://b.example.com']

  it('returns exact HTTPS origins', () => {
    expect(parseOriginAllowlist(JSON.stringify(origins))).toEqual(origins)
  })

  it('applies the hostname predicate', () => {
    const isAllowedHostname = (hostname: string) => hostname.endsWith('.example.com')
    expect(parseOriginAllowlist(JSON.stringify(origins), { isAllowedHostname })).toEqual(origins)
    expect(() =>
      parseOriginAllowlist('["https://evil.test"]', { isAllowedHostname, label: 'UPLOADS' }),
    ).toThrow('UPLOADS must contain exact HTTPS origins')
  })

  it.each([
    ['undefined', undefined],
    ['malformed JSON', '{'],
    ['non-array', '{}'],
    ['empty array', '[]'],
    ['non-string entry', '[1]'],
    ['unparseable URL', '["nope"]'],
    ['path suffix', '["https://a.example.com/"]'],
    ['http origin', '["http://a.example.com"]'],
    ['duplicates', '["https://a.example.com","https://a.example.com"]'],
  ])('rejects %s', (_name, raw) => {
    expect(() => parseOriginAllowlist(raw)).toThrow('Origin allowlist must contain exact HTTPS')
  })
})

describe('serializeCsp', () => {
  it('joins directives', () => {
    expect(serializeCsp({ 'default-src': ["'self'"], 'object-src': ["'none'"] })).toBe(
      "default-src 'self'; object-src 'none'",
    )
  })

  it.each(['a b', 'a;b', 'a,b', ''])('rejects the unsafe source %j', (source) => {
    expect(() => serializeCsp({ 'script-src': [source] })).toThrow('Invalid CSP source')
  })
})

describe('buildCsp', () => {
  it('builds strict defaults', () => {
    const csp = buildCsp()
    expect(directive(csp, 'script-src')).toBe("script-src 'self'")
    expect(directive(csp, 'object-src')).toBe("object-src 'none'")
    expect(directive(csp, 'frame-ancestors')).toBe("frame-ancestors 'self'")
    expect(csp).not.toContain('unsafe-eval')
  })

  it('adds the nonce to script-src', () => {
    expect(directive(buildCsp({ nonce: 'abc' }), 'script-src')).toBe(
      "script-src 'self' 'nonce-abc'",
    )
  })

  it('relaxes development builds only when production is false', () => {
    const development = buildCsp({ production: false })
    expect(directive(development, 'script-src')).toContain("'unsafe-eval'")
    expect(directive(development, 'img-src')).toContain(' http:')
    expect(buildCsp({ production: true })).not.toContain('unsafe-eval')
  })

  it('adds a normalized asset origin to asset directives and drops invalid ones', () => {
    const csp = buildCsp({ assetOrigin: 'https://cdn.example.com/x' })
    for (const name of ['script-src', 'style-src', 'img-src', 'font-src', 'connect-src']) {
      expect(directive(csp, name)).toContain('https://cdn.example.com')
    }
    expect(directive(csp, 'frame-src')).not.toContain('cdn.example.com')
    expect(buildCsp({ assetOrigin: 'javascript:alert(1)' })).toBe(buildCsp())
  })

  it('replaces and removes directives, then appends injected sources', () => {
    const csp = buildCsp({
      directives: { 'frame-src': ["'none'"], 'media-src': null, 'worker-src': ['blob:'] },
      sources: { 'connect-src': ['https://api.example.com'], 'font-src': ['https://fonts.test'] },
    })
    expect(directive(csp, 'frame-src')).toBe("frame-src 'none'")
    expect(directive(csp, 'media-src')).toBeUndefined()
    expect(directive(csp, 'worker-src')).toBe('worker-src blob:')
    expect(directive(csp, 'connect-src')).toBe("connect-src 'self' https://api.example.com")
    expect(directive(csp, 'font-src')).toBe("font-src 'self' https://fonts.test")
  })

  it('creates directives that only appear in sources', () => {
    expect(directive(buildCsp({ sources: { 'manifest-src': ["'self'"] } }), 'manifest-src')).toBe(
      "manifest-src 'self'",
    )
  })

  it('rejects injected sources that could add a directive', () => {
    expect(() => buildCsp({ sources: { 'script-src': ['https://x.test; img-src *'] } })).toThrow()
  })
})
