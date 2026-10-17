import { describe, expect, it, vi } from 'vitest'
import { ApiError } from './error.mts'
import { ServerRequest } from './server-request.mts'

const okFetch = () => vi.fn<typeof fetch>(async () => new Response('{"ok":1}'))

describe('ServerRequest', () => {
  it('builds absolute URLs and merges injected headers after caller headers', async () => {
    const fetchMock = okFetch()
    const resolveHeaders = vi.fn(() => ({ 'x-request-id': 'r1', 'X-Caller': 'injected' }))
    const server = new ServerRequest({
      baseUrl: 'https://api.example',
      fetch: fetchMock,
      resolveHeaders,
      fetchInit: { cache: 'no-store' },
    })

    await expect(server.get('/things', { headers: { 'X-Caller': 'caller' } })).resolves.toEqual({
      ok: 1,
    })

    expect(resolveHeaders).toHaveBeenCalledWith({
      method: 'GET',
      url: 'https://api.example/things',
      headers: { 'X-Caller': 'caller' },
    })
    expect(fetchMock).toHaveBeenCalledWith('https://api.example/things', {
      cache: 'no-store',
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Caller': 'injected',
        'x-request-id': 'r1',
      },
    })
  })

  it('resolves a base URL function per request and works without injected headers', async () => {
    const fetchMock = okFetch()
    const baseUrl = vi.fn(() => 'http://localhost:2900')
    const signal = new AbortController().signal
    await new ServerRequest({ baseUrl, fetch: fetchMock }).get('/a', { signal })
    expect(baseUrl).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:2900/a', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal,
    })
  })

  it('adds Origin to cookie-authenticated mutations', async () => {
    const fetchMock = okFetch()
    const server = new ServerRequest({
      baseUrl: 'https://api.example:8443/base',
      fetch: fetchMock,
      resolveHeaders: async () => ({ Cookie: 'st=1' }),
    })
    await server.post('/things', { a: 1 })
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({
      body: '{"a":1}',
      headers: { Cookie: 'st=1', Origin: 'https://api.example:8443' },
    })
  })

  it('detects caller-supplied cookies case-insensitively and skips Origin otherwise', async () => {
    const fetchMock = okFetch()
    const server = new ServerRequest({ baseUrl: 'https://api.example', fetch: fetchMock })
    await server.delete('/a', { headers: { cookie: 'x=1' } })
    await server.put('/a', undefined, { headers: { 'x-other': '1' } })
    await server.patch('/a')
    const [deleteInit, putInit] = fetchMock.mock.calls.map(([, init]) => init)
    expect(deleteInit?.headers).toMatchObject({ Origin: 'https://api.example' })
    expect(putInit?.headers).not.toHaveProperty('Origin')
    expect(fetchMock.mock.calls[2]![1]?.headers).not.toHaveProperty('Origin')
  })

  it('does not add Origin to GET requests even with cookies', async () => {
    const fetchMock = okFetch()
    await new ServerRequest({ baseUrl: 'https://api.example', fetch: fetchMock }).get('/a', {
      headers: { Cookie: 'x=1' },
    })
    expect(fetchMock.mock.calls[0]![1]?.headers).not.toHaveProperty('Origin')
  })

  it('returns undefined for 204 and empty bodies', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }))
    const server = new ServerRequest({ baseUrl: 'https://api.example', fetch: fetchMock })
    await expect(server.delete('/a')).resolves.toBeUndefined()
  })

  it('throws ApiError for failures', async () => {
    const response = new Response('{"code":"NOPE"}', { status: 403 })
    const server = new ServerRequest({
      baseUrl: 'https://api.example',
      fetch: vi.fn<typeof fetch>(async () => response),
    })
    await expect(server.get('/a')).rejects.toMatchObject({ status: 403, code: 'NOPE' })
    const offline = new ServerRequest({
      baseUrl: 'https://api.example',
      fetch: vi.fn<typeof fetch>().mockRejectedValue(new Error('down')),
    })
    const error = await offline.get('/a').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).message).toBe('down (GET https://api.example/a)')
  })
})
