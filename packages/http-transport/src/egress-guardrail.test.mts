import { MockAgent, fetch as undiciFetch } from 'undici'
import { describe, expect, it, vi } from 'vitest'
import { classifyOriginHost, createOriginGuardrailInterceptor } from './dispatchers.mts'

describe('classifyOriginHost', () => {
  const policy = {
    isExemptHost: (host: string) => host === 'localhost' || host === '127.0.0.1',
    isAllowedHost: (host: string) => host === 'allowed.example',
  }

  it('classifies missing, unparseable, exempt, allowed, and disallowed origins', () => {
    expect(classifyOriginHost(undefined, policy)).toBe('exempt')
    expect(classifyOriginHost('not a url', policy)).toBe('exempt')
    expect(classifyOriginHost('mailto:user@example.test', policy)).toBe('exempt')
    expect(classifyOriginHost('http://localhost:8080', policy)).toBe('exempt')
    expect(classifyOriginHost(new URL('https://allowed.example'), policy)).toBe('allowed')
    expect(classifyOriginHost('https://blocked.example', policy)).toBe('disallowed')
    expect(
      classifyOriginHost('https://blocked.example', {
        isAllowedHost: (host) => host === 'allowed.example',
      }),
    ).toBe('disallowed')
  })
})

describe('createOriginGuardrailInterceptor', () => {
  it('reports disallowed origins once by default, strips query strings, and still dispatches', async () => {
    const onDisallowedOrigin = vi.fn()
    const interceptor = createOriginGuardrailInterceptor({
      isExemptHost: (host) => host === 'localhost',
      isAllowedHost: (host) => host === 'allowed.example',
      onDisallowedOrigin,
    })

    const mock = new MockAgent()
    mock.disableNetConnect()
    mock.get('https://blocked.example').intercept({ path: '/search?q=secret' }).reply(200, 'one')
    mock.get('https://blocked.example').intercept({ path: '/other' }).reply(200, 'two')
    mock.get('https://allowed.example').intercept({ path: '/ok' }).reply(200, 'three')

    const guarded = mock.compose(interceptor)
    try {
      expect(
        await (
          await undiciFetch('https://blocked.example/search?q=secret', { dispatcher: guarded })
        ).text(),
      ).toBe('one')
      expect(
        await (await undiciFetch('https://blocked.example/other', { dispatcher: guarded })).text(),
      ).toBe('two')
      expect(
        await (await undiciFetch('https://allowed.example/ok', { dispatcher: guarded })).text(),
      ).toBe('three')

      expect(onDisallowedOrigin).toHaveBeenCalledTimes(1)
      expect(onDisallowedOrigin).toHaveBeenCalledWith('blocked.example', {
        path: '/search',
        method: 'GET',
      })
    } finally {
      await mock.close()
    }
  })

  it('can report every request when deduplicate is false and handles missing path/method', () => {
    const onDisallowedOrigin = vi.fn()
    const interceptor = createOriginGuardrailInterceptor({
      isAllowedHost: () => false,
      onDisallowedOrigin,
      deduplicate: false,
    })
    const dispatch = vi.fn(() => true)
    const wrapped = interceptor(dispatch as never)

    wrapped(
      { origin: 'https://blocked.example', path: '/plain', method: 'POST' } as never,
      {} as never,
    )
    wrapped(
      { origin: 'https://blocked.example', path: '', method: undefined } as never,
      {} as never,
    )
    wrapped(
      { origin: 'https://blocked.example', path: undefined, method: undefined } as never,
      {} as never,
    )

    expect(dispatch).toHaveBeenCalledTimes(3)
    expect(onDisallowedOrigin.mock.calls).toEqual([
      ['blocked.example', { path: '/plain', method: 'POST' }],
      ['blocked.example', { path: '' }],
      ['blocked.example', {}],
    ])
  })

  it('shares host deduplication across distinct composed dispatchers when reused', async () => {
    const onDisallowedOrigin = vi.fn()
    const egressGuard = createOriginGuardrailInterceptor({
      isAllowedHost: () => false,
      onDisallowedOrigin,
    })

    const routineMock = new MockAgent()
    const longRunningMock = new MockAgent()
    routineMock.disableNetConnect()
    longRunningMock.disableNetConnect()
    routineMock.get('https://shared.example').intercept({ path: '/a' }).reply(200, 'a')
    longRunningMock.get('https://shared.example').intercept({ path: '/b' }).reply(200, 'b')

    try {
      await undiciFetch('https://shared.example/a', {
        dispatcher: routineMock.compose(egressGuard),
      })
      await undiciFetch('https://shared.example/b', {
        dispatcher: longRunningMock.compose(egressGuard),
      })
      expect(onDisallowedOrigin).toHaveBeenCalledTimes(1)
      expect(onDisallowedOrigin).toHaveBeenCalledWith('shared.example', {
        path: '/a',
        method: 'GET',
      })
    } finally {
      await Promise.all([routineMock.close(), longRunningMock.close()])
    }
  })
})
