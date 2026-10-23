import { MockAgent } from 'undici'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchWithTimeout, fetchWithTimeoutSimple, isTimeoutError } from './fetch.mts'

const origin = 'http://upstream.test'
const addresses = [{ address: '93.184.216.34', family: 4 as const }]

describe('timed fetch', () => {
  let agent: MockAgent
  const getExternalRequestDispatcher = vi.fn()
  const getPinnedRequestDispatcher = vi.fn()
  const dispatchers = { getExternalRequestDispatcher, getPinnedRequestDispatcher }

  beforeEach(() => {
    agent = new MockAgent()
    agent.disableNetConnect()
    getExternalRequestDispatcher.mockReturnValue(agent)
    getPinnedRequestDispatcher.mockReturnValue(agent)
  })

  afterEach(async () => {
    vi.clearAllMocks()
    await agent.close()
  })

  const base = {
    url: `${origin}/a`,
    headers: { 'user-agent': 'test' },
    requestTimeoutMs: 1000,
    responseTimeoutMs: 1000,
    dispatchers,
  }

  it('returns the response without following redirects, using the shared dispatcher', async () => {
    agent
      .get(origin)
      .intercept({ path: '/a', headers: { 'user-agent': 'test' } })
      .reply(302, '', { headers: { location: '/b' } })
    const { response, responseSignal } = await fetchWithTimeout(base)
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/b')
    expect(responseSignal.aborted).toBe(false)
    expect(getExternalRequestDispatcher).toHaveBeenCalledOnce()
    expect(getPinnedRequestDispatcher).not.toHaveBeenCalled()
  })

  it('pins the connection when resolved addresses are supplied', async () => {
    agent.get(origin).intercept({ path: '/a' }).reply(200, 'ok')
    const { response } = await fetchWithTimeout({ ...base, resolvedAddresses: addresses })
    expect(await response.text()).toBe('ok')
    expect(getPinnedRequestDispatcher).toHaveBeenCalledWith(addresses)
    expect(getExternalRequestDispatcher).not.toHaveBeenCalled()
  })

  it('falls back to the shared dispatcher for an empty address list', async () => {
    agent.get(origin).intercept({ path: '/a' }).reply(200, 'ok')
    await fetchWithTimeout({ ...base, resolvedAddresses: [] })
    expect(getExternalRequestDispatcher).toHaveBeenCalledOnce()
  })

  it('aborts with a TimeoutError when headers arrive after the request timeout', async () => {
    agent.get(origin).intercept({ path: '/a' }).reply(200, 'late').delay(500)
    const error = await fetchWithTimeout({ ...base, requestTimeoutMs: 10 }).catch((e) => e)
    expect(isTimeoutError(error)).toBe(true)
  })

  it('starts the body clock only after headers arrive', async () => {
    agent.get(origin).intercept({ path: '/a' }).reply(200, 'ok').delay(50)
    const { responseSignal } = await fetchWithTimeout({ ...base, responseTimeoutMs: 100 })
    expect(responseSignal.aborted).toBe(false)
    await vi.waitFor(() => expect(responseSignal.aborted).toBe(true))
    expect(isTimeoutError(responseSignal.reason)).toBe(true)
  })

  it('propagates a caller signal to both phases', async () => {
    agent.get(origin).intercept({ path: '/a' }).reply(200, 'ok')
    const controller = new AbortController()
    const { responseSignal } = await fetchWithTimeout({ ...base, signal: controller.signal })
    controller.abort(new Error('stop'))
    expect(responseSignal.aborted).toBe(true)

    const aborted = AbortSignal.abort(new Error('already'))
    await expect(fetchWithTimeout({ ...base, signal: aborted })).rejects.toThrow('already')
  })

  it('fetchWithTimeoutSimple applies one timeout on the supplied dispatcher', async () => {
    agent.get(origin).intercept({ path: '/a' }).reply(200, 'robots')
    const response = await fetchWithTimeoutSimple(`${origin}/a`, 1000, agent)
    expect(await response.text()).toBe('robots')

    agent.get(origin).intercept({ path: '/a' }).reply(200, 'late').delay(500)
    const error = await fetchWithTimeoutSimple(`${origin}/a`, 10, agent).catch((e) => e)
    expect(isTimeoutError(error)).toBe(true)
  })
})
