import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fetch as undiciFetch, MockAgent, type Agent, type Dispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHttpDispatchers, type HttpDispatchersOptions } from './dispatchers.mts'
import * as dispatchersModule from './dispatchers.mts'

const onError = vi.fn()
const marker = vi.fn()
const interceptor: Dispatcher.DispatcherComposeInterceptor = (dispatch) => (opts, handler) => {
  marker(opts.path)
  return dispatch(opts, handler)
}

describe('createHttpDispatchers', () => {
  let enabled = false
  let resources: ReturnType<typeof createHttpDispatchers>
  let servers: Server[] = []

  const create = (options: Partial<HttpDispatchersOptions> = {}) =>
    createHttpDispatchers({
      onError,
      interceptors: () => (enabled ? [interceptor] : []),
      ...options,
    })

  async function listen(host = '127.0.0.1'): Promise<number> {
    const server = createServer((_request, response) => {
      response.end(response.socket?.remoteFamily ?? 'ok')
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, host, resolve))
    return (server.address() as AddressInfo).port
  }

  beforeEach(() => {
    enabled = false
    resources = create()
  })

  afterEach(async () => {
    vi.clearAllMocks()
    await resources[Symbol.asyncDispose]()
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))))
    servers = []
  })

  it('ships documented timeout profile defaults', () => {
    expect(dispatchersModule.EXTERNAL_DISPATCHER_HEADERS_TIMEOUT_MS).toBe(60_000)
    expect(dispatchersModule.LONG_RUNNING_EXTERNAL_DISPATCHER_HEADERS_TIMEOUT_MS).toBe(300_000)
    expect(dispatchersModule.EXTERNAL_DISPATCHER_BODY_TIMEOUT_MS).toBe(300_000)
    expect(dispatchersModule.EXTERNAL_DISPATCHER_KEEP_ALIVE_TIMEOUT_MS).toBe(4_000)
    expect(dispatchersModule.EXTERNAL_DISPATCHER_KEEP_ALIVE_MAX_TIMEOUT_MS).toBe(600_000)
    expect(dispatchersModule.EXTERNAL_DISPATCHER_CONNECT_TIMEOUT_MS).toBe(10_000)
  })

  it('accepts timeout, connection, and cache overrides', async () => {
    const custom = create({
      headersTimeoutMs: 1,
      longRunningHeadersTimeoutMs: 2,
      bodyTimeoutMs: 3,
      keepAliveTimeoutMs: 4,
      keepAliveMaxTimeoutMs: 5,
      connectTimeoutMs: 6,
      connections: 1,
      pinnedCacheSize: 1,
    })
    expect(custom.getExternalRequestDispatcher()).not.toBe(resources.getExternalRequestDispatcher())
    await custom.closeHttpDispatchers()
  })

  it('shares distinct raw dispatchers for routine and long-running profiles', () => {
    const routine = resources.getExternalRequestDispatcher()
    const longRunning = resources.getLongRunningExternalRequestDispatcher()
    expect(resources.getExternalRequestDispatcher()).toBe(routine)
    expect(resources.getLongRunningExternalRequestDispatcher()).toBe(longRunning)
    expect(longRunning).not.toBe(routine)
  })

  it('composes injected interceptors once per base dispatcher when enabled', async () => {
    const port = await listen()
    const raw = resources.getExternalRequestDispatcher()
    enabled = true
    const guarded = resources.getExternalRequestDispatcher()
    const guardedLong = resources.getLongRunningExternalRequestDispatcher()
    expect(guarded).not.toBe(raw)
    expect(guardedLong).not.toBe(guarded)
    expect(resources.getExternalRequestDispatcher()).toBe(guarded)
    for (const dispatcher of [guarded, guardedLong]) {
      const response = await undiciFetch(`http://127.0.0.1:${port}/guarded`, { dispatcher })
      expect(await response.text()).toBe('IPv4')
    }
    expect(marker).toHaveBeenCalledTimes(2)
    enabled = false
    expect(resources.getExternalRequestDispatcher()).toBe(raw)
  })

  it('returns stable fetch functions that use the owner dispatchers', async () => {
    const port = await listen()
    const routine = resources.getExternalFetch()
    expect(resources.getExternalFetch()).toBe(routine)
    expect(resources.getLongRunningExternalFetch()).not.toBe(routine)
    enabled = true
    expect(await (await routine(`http://127.0.0.1:${port}/a`)).text()).toBe('IPv4')
    const longRunning = resources.getLongRunningExternalFetch()
    expect(await (await longRunning(new URL(`http://127.0.0.1:${port}/b`))).text()).toBe('IPv4')
    expect(marker.mock.calls).toEqual([['/a'], ['/b']])
  })

  it('composes a caller-supplied dispatcher instead of bypassing the interceptors', async () => {
    const mock = new MockAgent()
    mock.disableNetConnect()
    mock.get('http://localhost').intercept({ path: '/custom' }).reply(200, 'custom').times(2)
    try {
      const response = await resources.getExternalFetch()('http://localhost/custom', {
        dispatcher: mock,
      } as unknown as RequestInit)
      expect(await response.text()).toBe('custom')
      expect(marker).not.toHaveBeenCalled()
      enabled = true
      const guarded = await resources.getExternalFetch()('http://localhost/custom', {
        dispatcher: mock,
      } as unknown as RequestInit)
      expect(await guarded.text()).toBe('custom')
      expect(marker).toHaveBeenCalledWith('/custom')
    } finally {
      await mock.close()
    }
  })

  it('pins a cached dispatcher per address set, ignoring order and interceptors', async () => {
    enabled = true
    const a = { address: '93.184.216.34', family: 4 as const }
    const b = { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 as const }
    const first = resources.getPinnedRequestDispatcher([a, b])
    expect(resources.getPinnedRequestDispatcher([b, a])).toBe(first)
    expect(resources.getPinnedRequestDispatcher([a])).not.toBe(first)

    const port = await listen('::')
    const pinned = resources.getPinnedRequestDispatcher([
      { address: '::1', family: 6 },
      { address: '127.0.0.1', family: 4 },
    ])
    const response = await undiciFetch(`http://example.test:${port}/`, { dispatcher: pinned })
    expect(await response.text()).toBe('IPv6')
    expect(marker).not.toHaveBeenCalled()
  })

  it('closes once, shares the promise, and reports close failures to onError', async () => {
    const routine = resources.getExternalRequestDispatcher()
    const failure = new Error('already closed')
    const close = vi.spyOn(routine, 'close').mockRejectedValueOnce(failure)
    try {
      const first = resources.closeHttpDispatchers()
      expect(resources.closeHttpDispatchers()).toBe(first)
      await first
      expect(close).toHaveBeenCalledOnce()
      expect(onError).toHaveBeenCalledWith(failure)
      expect(() =>
        resources.getPinnedRequestDispatcher([{ address: '127.0.0.1', family: 4 }]),
      ).toThrow('closed')
    } finally {
      close.mockRestore()
      await routine.destroy()
    }
  })

  it('disposes one owner without closing another', async () => {
    await using other = create()
    const otherRoutine = other.getExternalRequestDispatcher()
    await resources[Symbol.asyncDispose]()
    expect(other.getExternalRequestDispatcher()).toBe(otherRoutine)
    expect((otherRoutine as Agent).closed).toBe(false)
  })
})
