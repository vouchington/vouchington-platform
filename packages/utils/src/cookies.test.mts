import { describe, expect, it } from 'vitest'
import { parseCookies, serializeCookie } from './cookies.mts'

const safeAttributes = {
  httpOnly: true,
  maxAge: 60,
  path: '/',
  sameSite: 'lax',
  secure: true,
} as const

describe('cookie serialization', () => {
  it('serializes caller-owned cookie names, values, and policy', () => {
    expect(serializeCookie('access-token', 'token.value_~', safeAttributes)).toBe(
      'access-token=token.value_~; Max-Age=60; Path=/; SameSite=Lax; HttpOnly; Secure',
    )
    expect(
      serializeCookie('state', '', {
        httpOnly: false,
        maxAge: 0,
        path: '/callback',
        sameSite: 'strict',
        secure: false,
      }),
    ).toBe('state=; Max-Age=0; Path=/callback; SameSite=Strict')
  })

  it.each(['', 'with space', 'equals=name', 'comma,name', 'quote"name', 'bracket[name]'])(
    'rejects invalid cookie name %j',
    (name) => expect(() => serializeCookie(name, 'ok', safeAttributes)).toThrow('cookie name'),
  )

  it.each(['bad;value', 'bad value', 'bad,value', 'bad"value', 'bad\\value', 'café', 'bad\nvalue'])(
    'rejects invalid cookie value %j',
    (value) =>
      expect(() => serializeCookie('state', value, safeAttributes)).toThrow('cookie value'),
  )

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid Max-Age %s',
    (maxAge) =>
      expect(() => serializeCookie('state', 'ok', { ...safeAttributes, maxAge })).toThrow(
        'Max-Age',
      ),
  )

  it.each(['', 'relative', '/safe; Domain=example.test', '/bad\r\nInjected: yes', '/café'])(
    'rejects unsafe Path %j',
    (path) =>
      expect(() => serializeCookie('state', 'ok', { ...safeAttributes, path })).toThrow(
        'Cookie Path',
      ),
  )

  it('rejects invalid runtime attributes and insecure SameSite=None', () => {
    expect(() =>
      serializeCookie('state', 'ok', { ...safeAttributes, sameSite: 'invalid' as 'lax' }),
    ).toThrow('SameSite')
    expect(() =>
      serializeCookie('state', 'ok', { ...safeAttributes, httpOnly: 'yes' as unknown as boolean }),
    ).toThrow('boolean')
    expect(() =>
      serializeCookie('state', 'ok', { ...safeAttributes, secure: 'yes' as unknown as boolean }),
    ).toThrow('boolean')
    expect(() =>
      serializeCookie('state', 'ok', { ...safeAttributes, sameSite: 'none', secure: false }),
    ).toThrow('must be Secure')
    expect(
      serializeCookie('state', 'ok', { ...safeAttributes, sameSite: 'none', secure: true }),
    ).toContain('SameSite=None')
  })
})

describe('cookie parsing', () => {
  it('parses cookie headers into a map and ignores malformed segments', () => {
    const parsed = parseCookies('foo=bar; st=token; dt=abc')
    expect(parsed.get('foo')).toBe('bar')
    expect(parsed.get('st')).toBe('token')
    expect(parsed.get('dt')).toBe('abc')
    const messy = parseCookies('foo=bar; missing-equals; =empty;  =blank; spaced = value ')
    expect(messy.get('foo')).toBe('bar')
    expect(messy.get('spaced')).toBe('value')
    expect(messy.has('missing-equals')).toBe(false)
    expect(messy.has('')).toBe(false)
    expect(parseCookies(' =blank').size).toBe(0)
    expect(parseCookies(null).size).toBe(0)
    expect(parseCookies(undefined).size).toBe(0)
    expect(parseCookies('').size).toBe(0)
  })
})
