import { createServer, type Server } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createHttpDispatchers,
  createProxyRoutedDispatchers,
  type HttpDispatchers,
  type ProxyRoutedDispatchers,
} from './dispatchers.mts'

describe('createProxyRoutedDispatchers', () => {
  let direct: HttpDispatchers
  let routed: ProxyRoutedDispatchers<'alpha' | 'beta'>
  let proxyUrl: string
  let onError: ReturnType<typeof vi.fn<(error: unknown) => void>>
  const servers: Server[] = []

  async function listen(): Promise<number> {
    const server = createServer((_req, res) => {
      res.end('direct-ok')
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected IP address')
    return address.port
  }

  beforeEach(() => {
    proxyUrl = 'http://127.0.0.1:3128'
    onError = vi.fn()
    direct = createHttpDispatchers({ onError })
    routed = createProxyRoutedDispatchers<'alpha' | 'beta'>({
      direct,
      getProxyUrl: () => {
        if (!proxyUrl) throw new Error('proxy URL missing')
        return proxyUrl
      },
      onError,
    })
  })

  afterEach(async () => {
    try {
      await routed[Symbol.asyncDispose]()
    } finally {
      await direct[Symbol.asyncDispose]()
      await Promise.all(
        servers
          .splice(0)
          .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
      )
      vi.restoreAllMocks()
    }
  })

  it('uses the direct dispatchers when no resolver is installed or route is disabled', async () => {
    expect(routed.isProxyRouteEnabled('alpha')).toBe(false)
    expect(routed.getRoutedRequestDispatcher('alpha')).toBe(direct.getExternalRequestDispatcher())
    expect(routed.getRoutedRequestDispatcher('beta', 'long-running')).toBe(
      direct.getLongRunningExternalRequestDispatcher(),
    )

    const port = await listen()
    const routineFetch = routed.getRoutedFetch('alpha')
    const longFetch = routed.getRoutedFetch('beta', 'long-running')
    expect(await (await routineFetch(`http://127.0.0.1:${port}/a`)).text()).toBe('direct-ok')
    expect(await (await longFetch(`http://127.0.0.1:${port}/b`)).text()).toBe('direct-ok')
  })

  it('switches between direct and lazy per-profile proxy pools at request time', async () => {
    let enabled = false
    routed.setRoutingResolver(() => enabled)
    const directDispatcher = routed.getRoutedRequestDispatcher('alpha')
    expect(directDispatcher).toBe(direct.getExternalRequestDispatcher())

    enabled = true
    expect(routed.isProxyRouteEnabled('alpha')).toBe(true)
    const routineProxy = routed.getRoutedRequestDispatcher('alpha')
    const longProxy = routed.getRoutedRequestDispatcher('beta', 'long-running')
    expect(routineProxy).not.toBe(directDispatcher)
    expect(longProxy).not.toBe(routineProxy)
    expect(routed.getRoutedRequestDispatcher('alpha')).toBe(routineProxy)
    expect(routed.getRoutedRequestDispatcher('beta', 'long-running')).toBe(longProxy)

    enabled = false
    expect(routed.getRoutedRequestDispatcher('alpha')).toBe(directDispatcher)
  })

  it('evaluates routing and proxy URL lazily on every held fetch call', async () => {
    proxyUrl = ''
    const heldFetch = routed.getRoutedFetch('alpha')
    expect(() => routed.getRoutedRequestDispatcher('alpha')).not.toThrow()

    routed.setRoutingResolver(() => true)
    await expect(
      heldFetch('https://example.test', { signal: AbortSignal.abort() }),
    ).rejects.toThrow('proxy URL missing')

    proxyUrl = 'http://127.0.0.1:1'
    await expect(
      heldFetch('https://example.test', { signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ name: 'AbortError' })

    routed.setRoutingResolver(undefined)
    await expect(
      heldFetch('https://example.test', { signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('closes idempotently, reports close failures, and leaves other instances intact', async () => {
    await using custom = createProxyRoutedDispatchers({
      direct,
      getProxyUrl: () => 'http://127.0.0.1:3128',
      isProxyEnabled: () => true,
      onError,
      headersTimeoutMs: 1_000,
      longRunningHeadersTimeoutMs: 2_000,
      bodyTimeoutMs: 3_000,
      keepAliveTimeoutMs: 4_000,
      keepAliveMaxTimeoutMs: 5_000,
      connectTimeoutMs: 6_000,
      connections: 2,
    })

    routed.setRoutingResolver(() => true)
    const proxy = routed.getRoutedRequestDispatcher('alpha')
    const otherProxy = custom.getRoutedRequestDispatcher('other')
    const closeFailure = new Error('close failed')
    const closeSpy = vi.spyOn(proxy, 'close').mockRejectedValueOnce(closeFailure)
    const otherCloseSpy = vi.spyOn(otherProxy, 'close')

    try {
      const first = routed.closeProxyDispatchers()
      expect(routed.closeProxyDispatchers()).toBe(first)
      await first
      expect(closeSpy).toHaveBeenCalledOnce()
      expect(onError).toHaveBeenCalledWith(closeFailure)
      expect(otherCloseSpy).not.toHaveBeenCalled()
    } finally {
      closeSpy.mockRestore()
      otherCloseSpy.mockRestore()
      await proxy.destroy()
    }
  })
})
