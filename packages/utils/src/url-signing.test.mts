import { describe, expect, it } from 'vitest'
import {
  authorizeDependencyStates,
  buildSignedProxyUrl,
  createProtectedHostPolicy,
  hostnameOf,
  matchRouteSegment,
  normalizeHostname,
  parseSigningKeys,
  signExpiringPath,
  signPath,
  signPathWithKey,
  verifyExpiringPath,
  verifyPathSignature,
  verifyPathWithKey,
} from './url-signing.mts'

const key = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const other = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210'

describe('path signing', () => {
  it('signs and verifies a path', () => {
    const signature = signPathWithKey('/resource/a', key)
    expect(signature).toMatch(/^[\da-f]{64}$/)
    expect(verifyPathWithKey('/resource/a', signature, key)).toBe(true)
  })

  it('fails closed for tampering, malformed signatures, and keys', () => {
    const signature = signPathWithKey('/resource/a', key)
    expect(verifyPathWithKey('/resource/b', signature, key)).toBe(false)
    expect(verifyPathWithKey('/resource/a', 'not-a-signature', key)).toBe(false)
    expect(() => signPathWithKey('/resource/a', 'bad')).toThrow('64 hexadecimal')
  })
})

describe('key lists', () => {
  it('parses, trims, and skips empty and placeholder entries', () => {
    expect(parseSigningKeys(undefined)).toEqual([])
    expect(parseSigningKeys('')).toEqual([])
    expect(parseSigningKeys(` ${key} , ,placeholder,${other}`)).toEqual([key, other])
    expect(parseSigningKeys('TODO,abc', { placeholder: 'todo' })).toEqual(['abc'])
  })

  it('signs with the first usable key', () => {
    expect(signPath('/a', ['bad', key, other])).toBe(signPathWithKey('/a', key))
    expect(signPath('/a', [])).toBe('')
    expect(signPath('/a', ['bad'])).toBe('')
  })

  it('verifies against any key and ignores invalid keys', () => {
    const signature = signPathWithKey('/a', other)
    expect(verifyPathSignature('/a', signature, ['bad', key, other])).toBe(true)
    expect(verifyPathSignature('/a', signature, [key])).toBe(false)
    expect(verifyPathSignature('/a', signature, ['bad'])).toBe(false)
  })

  it('fails closed with no keys unless unsigned dev mode is allowed', () => {
    expect(verifyPathSignature('/a', '', [])).toBe(false)
    expect(verifyPathSignature('/a', '', [], { allowUnsignedWhenNoKeys: true })).toBe(true)
  })
})

describe('expiring signatures', () => {
  const expiresAt = 2_000

  it('verifies before and at expiry, and rejects after', () => {
    const signature = signExpiringPath('/a', expiresAt, [key])
    expect(verifyExpiringPath('/a', expiresAt, signature, [key], { now: 1_000 })).toBe(true)
    expect(verifyExpiringPath('/a', expiresAt, signature, [key], { now: expiresAt })).toBe(true)
    expect(verifyExpiringPath('/a', expiresAt, signature, [key], { now: 2_001 })).toBe(false)
  })

  it('binds the expiry and path to the signature', () => {
    const signature = signExpiringPath('/a', expiresAt, [key])
    expect(verifyExpiringPath('/a', 9_000, signature, [key], { now: 1 })).toBe(false)
    expect(verifyExpiringPath('/b', expiresAt, signature, [key], { now: 1 })).toBe(false)
    expect(verifyExpiringPath('/a', expiresAt, signPath('/a', [key]), [key], { now: 1 })).toBe(
      false,
    )
  })

  it('rejects unsafe expiry values and defaults to the wall clock', () => {
    expect(verifyExpiringPath('/a', Number.NaN, '', [key])).toBe(false)
    const future = Date.now() + 60_000
    expect(verifyExpiringPath('/a', future, signExpiringPath('/a', future, [key]), [key])).toBe(
      true,
    )
    expect(verifyExpiringPath('/a', 1, signExpiringPath('/a', 1, [key]), [key])).toBe(false)
    expect(signExpiringPath('/a', future, [])).toBe('')
  })
})

describe('signed proxy URLs', () => {
  const base = {
    origin: 'https://img.example.test/ignored',
    pathPrefix: '/p/v1/',
    signingKeys: [key],
  }

  it('encodes the target, orders query parameters, and signs the path', () => {
    const url = buildSignedProxyUrl(' https://cdn.test/a.png ', {
      ...base,
      query: { w: 320, q: undefined, fit: 'cover' },
    })
    const parsed = new URL(url ?? '')
    const path = `/p/v1/${Buffer.from('https://cdn.test/a.png').toString('base64url')}`
    expect(parsed.origin).toBe('https://img.example.test')
    expect(parsed.pathname).toBe(path)
    expect([...parsed.searchParams.keys()]).toEqual(['w', 'fit', 'sig'])
    expect(parsed.searchParams.get('sig')).toBe(signPathWithKey(path, key))
  })

  it('omits the signature without usable keys and supports a custom parameter', () => {
    const unsigned = buildSignedProxyUrl('https://cdn.test/a.png', { ...base, signingKeys: [] })
    expect(unsigned).toMatch(/^https:\/\/img\.example\.test\/p\/v1\/[\w-]+$/)
    const custom = buildSignedProxyUrl('https://cdn.test/a.png', {
      ...base,
      query: { w: 1 },
      signatureParam: 's',
    })
    expect(new URL(custom ?? '').searchParams.has('s')).toBe(true)
  })

  it('returns null for unproxyable inputs', () => {
    for (const input of ['', '  ', '//cdn.test/a', '/relative', 'ftp://cdn.test/a', 'not a url']) {
      expect(buildSignedProxyUrl(input, base)).toBeNull()
    }
    expect(buildSignedProxyUrl('https://img.example.test/p/v1/abc', base)).toBeNull()
    expect(
      buildSignedProxyUrl('https://cdn.test/a', {
        ...base,
        skip: (url) => url.hostname === 'cdn.test',
      }),
    ).toBeNull()
    expect(
      buildSignedProxyUrl('https://other.test/a', { ...base, skip: () => false }),
    ).not.toBeNull()
  })
})

describe('host policy and routes', () => {
  it('normalizes hostnames from URLs and bare hosts', () => {
    expect(normalizeHostname('Example.TEST.')).toBe('example.test')
    expect(hostnameOf('https://Img.Example.test:8443/x')).toBe('img.example.test')
    expect(hostnameOf(' Bare.Test. ')).toBe('bare.test')
    expect(hostnameOf('   ')).toBeUndefined()
    expect(hostnameOf('http://')).toBeUndefined()
  })

  it('protects hosts and subdomains, with per-call extras', () => {
    const policy = createProtectedHostPolicy([
      'images.test',
      'https://cdn.test/path',
      '',
      'http://',
    ])
    expect(policy.hosts()).toEqual(['images.test', 'cdn.test'])
    expect(policy.isProtected(new URL('https://IMAGES.test./a'))).toBe(true)
    expect(policy.isProtected(new URL('https://a.cdn.test/a'))).toBe(true)
    expect(policy.isProtected(new URL('https://notcdn.test/a'))).toBe(false)
    expect(policy.isProtected(new URL('https://extra.test/a'))).toBe(false)
    expect(policy.isProtected(new URL('https://extra.test/a'), ['extra.test'])).toBe(true)
    expect(policy.blockedHosts()).toEqual({
      exact: ['images.test', 'cdn.test'],
      suffixes: ['.images.test', '.cdn.test'],
    })
  })

  it('matches a single route segment', () => {
    expect(matchRouteSegment('/p/v1/abc', '/p/v1/')).toBe('abc')
    expect(matchRouteSegment('/p/v1/', '/p/v1/')).toBeUndefined()
    expect(matchRouteSegment('/p/v1/a/b', '/p/v1/')).toBeUndefined()
    expect(matchRouteSegment('/other/abc', '/p/v1/')).toBeUndefined()
  })

  it('denies delivery unless every dependency is allowed', () => {
    expect(authorizeDependencyStates([])).toBe('allow')
    expect(authorizeDependencyStates(['allow', 'allow'])).toBe('allow')
    expect(authorizeDependencyStates(['allow', 'withheld'])).toBe('deny')
    expect(authorizeDependencyStates(['unknown'])).toBe('deny')
  })
})
