import { describe, expect, it, vi } from 'vitest'
import { createBasicAuthExemptMatcher, createBasicAuthGate } from './basic-auth.mts'
import {
  basicAuthorizationMatches,
  readBasicAuthCredentialList,
  requiredBasicAuthDecision,
  timingSafeCredentialMatch,
} from './basic-auth-credentials.mts'

const basic = (credential: string) => `Basic ${btoa(credential)}`
const request = (path: string, headers: Record<string, string> = {}, method = 'GET') =>
  new Request(`https://example.com${path}`, { method, headers })

describe('timingSafeCredentialMatch', () => {
  it('matches only exact credentials', () => {
    const credentials = new Set(['a:b', 'longer:secret'])
    expect(timingSafeCredentialMatch('a:b', credentials)).toBe(true)
    expect(timingSafeCredentialMatch('longer:secret', credentials)).toBe(true)
    expect(timingSafeCredentialMatch('a:c', credentials)).toBe(false)
    expect(timingSafeCredentialMatch('a:', credentials)).toBe(false)
    expect(timingSafeCredentialMatch('a:b', new Set())).toBe(false)
  })
})

describe('readBasicAuthCredentialList', () => {
  it('treats unset and blank values as absent', () => {
    expect(readBasicAuthCredentialList(undefined)).toEqual({ status: 'absent' })
    expect(readBasicAuthCredentialList('  ')).toEqual({ status: 'absent' })
  })

  it('parses rotation lists and flags malformed entries', () => {
    const list = readBasicAuthCredentialList('a:b,c:d')
    expect(list).toMatchObject({ status: 'configured', hasMalformedEntries: false })
    expect(list.status === 'configured' && [...list.credentials]).toEqual(['a:b', 'c:d'])
    for (const bad of ['a:b,', ':b', 'a:', 'nocolon']) {
      expect(readBasicAuthCredentialList(bad)).toMatchObject({ hasMalformedEntries: true })
    }
  })

  it('memoizes parsed lists and bounds the memo', () => {
    const first = readBasicAuthCredentialList('m:1')
    expect(readBasicAuthCredentialList('m:1')).toBe(first)
    for (let i = 0; i < 20; i++) readBasicAuthCredentialList(`bound:${i}`)
    expect(readBasicAuthCredentialList('m:1')).toEqual(first)
  })
})

describe('basicAuthorizationMatches', () => {
  const credentials = new Set(['user:pass'])

  it('accepts a matching Basic header', () => {
    expect(basicAuthorizationMatches(basic('user:pass'), credentials)).toBe(true)
    expect(basicAuthorizationMatches(`basic   ${btoa('user:pass')}`, credentials)).toBe(true)
  })

  it.each([
    ['null', null],
    ['wrong scheme', 'Bearer abc'],
    ['wrong password', basic('user:nope')],
    ['bad base64 charset', 'Basic !!!'],
    ['invalid base64 length', 'Basic abcde'],
  ])('rejects %s', (_name, header) => {
    expect(basicAuthorizationMatches(header, credentials)).toBe(false)
  })
})

describe('requiredBasicAuthDecision', () => {
  it('fails closed on missing or malformed configuration', () => {
    expect(requiredBasicAuthDecision(basic('a:b'), undefined)).toBe('misconfigured')
    expect(requiredBasicAuthDecision(basic('a:b'), 'a:b,bad')).toBe('misconfigured')
    expect(requiredBasicAuthDecision(basic('a:b'), ',')).toBe('misconfigured')
  })

  it('authorizes or rejects against a valid list', () => {
    expect(requiredBasicAuthDecision(basic('a:b'), 'a:b')).toBe('authorized')
    expect(requiredBasicAuthDecision(basic('a:c'), 'a:b')).toBe('unauthorized')
    expect(requiredBasicAuthDecision(null, 'a:b')).toBe('unauthorized')
  })
})

describe('createBasicAuthExemptMatcher', () => {
  const matcher = createBasicAuthExemptMatcher(
    { '/Health': ['get', 'HEAD'], '/hook': ['POST'] },
    (method, path) => method === 'GET' && path === '/dynamic',
  )

  it('matches by normalized path and method', () => {
    expect(matcher('GET', '/health')).toBe(true)
    expect(matcher('head', '/HEALTH/')).toBe(true)
    expect(matcher('POST', '/hook')).toBe(true)
    expect(matcher('GET', '/hook')).toBe(false)
    expect(matcher('GET', '/other')).toBe(false)
  })

  it('keeps the root path and consults the extra matcher with the normalized path', () => {
    expect(matcher('GET', '/')).toBe(false)
    expect(matcher('GET', '/Dynamic/')).toBe(true)
    expect(matcher('POST', '/dynamic')).toBe(false)
  })

  it('works without an extra matcher', () => {
    expect(createBasicAuthExemptMatcher({})('GET', '/x')).toBe(false)
  })
})

describe('createBasicAuthGate', () => {
  const options = { credentials: 'user:pass', realm: 'Staging' }

  it('rejects realms that could break the challenge header', () => {
    for (const realm of ['a"b', 'a\\b', 'a\nb']) {
      expect(() => createBasicAuthGate({ credentials: 'a:b', realm })).toThrow(
        'Invalid Basic auth realm',
      )
    }
  })

  it('is disabled without credentials', () => {
    const gate = createBasicAuthGate({ ...options, credentials: undefined })
    expect(gate.appliesTo(request('/'))).toBe(false)
    expect(gate.check(request('/'))).toBeNull()
  })

  it('challenges unauthenticated requests and accepts valid ones', async () => {
    const gate = createBasicAuthGate(options)
    const challenge = gate.check(request('/'))
    expect(challenge?.status).toBe(401)
    expect(challenge?.headers.get('www-authenticate')).toBe(
      'Basic realm="Staging", charset="UTF-8"',
    )
    expect(await challenge?.json()).toEqual({
      message: 'Authentication required',
      code: 'UNAUTHORIZED',
    })
    expect(gate.check(request('/', { authorization: basic('user:pass') }))).toBeNull()
    expect(gate.check(request('/', { authorization: basic('user:bad') }))?.status).toBe(401)
    expect(gate.check(request('/', { authorization: 'Bearer token' }))?.status).toBe(401)
    expect(gate.appliesTo(request('/'))).toBe(true)
  })

  it('skips exempt requests', () => {
    const isExempt = createBasicAuthExemptMatcher({ '/open': ['GET'] })
    const gate = createBasicAuthGate({ ...options, isExempt })
    expect(gate.check(request('/open'))).toBeNull()
    expect(gate.appliesTo(request('/open'))).toBe(false)
    expect(gate.appliesTo(request('/closed'))).toBe(true)
  })

  it('reads Basic credentials from the secondary header next to a Bearer token', () => {
    const gate = createBasicAuthGate({ ...options, secondaryAuthorizationHeader: 'x-staging-auth' })
    const bearer = { authorization: 'Bearer abc', 'x-staging-auth': basic('user:pass') }
    expect(gate.check(request('/', bearer))).toBeNull()
    expect(gate.check(request('/', { 'x-staging-auth': basic('user:pass') }))?.status).toBe(401)
    const mixed = { authorization: basic('user:pass'), 'x-staging-auth': basic('user:pass') }
    expect(gate.check(request('/', mixed))?.status).toBe(401)
    expect(gate.check(request('/', { authorization: basic('user:pass') }))).toBeNull()
  })

  it('ignores a secondary header that is not configured', () => {
    const gate = createBasicAuthGate(options)
    const headers = { authorization: 'Bearer abc', 'x-staging-auth': basic('user:pass') }
    expect(gate.check(request('/', headers))?.status).toBe(401)
  })

  it('fails closed on malformed lists and warns once per gate', () => {
    const warn = vi.fn()
    const gate = createBasicAuthGate({ credentials: 'user:pass,bad', realm: 'R', warn })
    expect(gate.check(request('/', { authorization: basic('user:pass') }))?.status).toBe(401)
    expect(gate.check(request('/'))?.status).toBe(401)
    expect(gate.appliesTo(request('/'))).toBe(true)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toContain('malformed credential list')
  })

  it('warns through console.warn by default', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    createBasicAuthGate({ credentials: 'bad', realm: 'R' }).check(request('/'))
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })
})
