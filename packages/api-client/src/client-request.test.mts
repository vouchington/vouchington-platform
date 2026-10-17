import { describe, expect, it, vi } from 'vitest'
import { ClientRequest } from './client-request.mts'
import { ApiError } from './error.mts'

function mockFetch(response: Response | Error) {
  return vi.fn<typeof fetch>(async () => {
    if (response instanceof Error) throw response
    return response
  })
}

describe('ClientRequest', () => {
  it('sends credentialed JSON with injected base URL and headers', async () => {
    const fetchMock = mockFetch(new Response('{"ok":true}'))
    const client = new ClientRequest({
      baseUrl: 'https://api.example',
      fetch: fetchMock,
      headers: async () => ({ Authorization: 'Bearer t', 'X-Trace': 'injected' }),
    })

    await expect(
      client.post('/things', { a: 1 }, { headers: { 'X-Trace': 'caller' } }),
    ).resolves.toEqual({ ok: true })

    expect(fetchMock).toHaveBeenCalledWith('https://api.example/things', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer t',
        'X-Trace': 'caller',
      },
      credentials: 'include',
      body: '{"a":1}',
    })
  })

  it('uses relative URLs, GET without a body, search params, and a signal by default', async () => {
    const fetchMock = mockFetch(new Response('[]'))
    const signal = new AbortController().signal
    const client = new ClientRequest({ fetch: fetchMock, credentials: 'same-origin' })

    await client.get('/things', { searchParams: { q: 'a b', skip: undefined }, signal })

    expect(fetchMock).toHaveBeenCalledWith('/things?q=a+b', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      signal,
    })
  })

  it('does not serialize bodies for GET requests', async () => {
    const fetchMock = mockFetch(new Response('1'))
    await new ClientRequest({ fetch: fetchMock }).request('/x', { body: { a: 1 } })
    expect(fetchMock.mock.calls[0]![1]).not.toHaveProperty('body')
  })

  it('uses the global fetch when none is injected', async () => {
    const globalFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"g":1}'))
    await expect(new ClientRequest().get('/g')).resolves.toEqual({ g: 1 })
    globalFetch.mockRestore()
  })

  it('exposes put, patch, and delete verbs', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(''))
    const client = new ClientRequest({ fetch: fetchMock })
    await client.put('/a', { x: 1 })
    await client.patch('/a', { x: 2 })
    await client.delete('/a')
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['PUT', 'PATCH', 'DELETE'])
  })

  it('returns undefined for empty successful bodies', async () => {
    const client = new ClientRequest({ fetch: mockFetch(new Response('  ')) })
    await expect(client.get('/empty')).resolves.toBeUndefined()
  })

  it('throws ApiError with the parsed error body', async () => {
    const response = new Response('{"message":"nope","code":"BAD"}', {
      status: 400,
      statusText: 'Bad Request',
    })
    const error = await new ClientRequest({ fetch: mockFetch(response) })
      .get('/x')
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 400, code: 'BAD', message: 'nope' })
  })

  it('adds retry_after to 429 responses', async () => {
    const response = new Response('{"code":"SLOW"}', {
      status: 429,
      headers: { 'Retry-After': '7' },
    })
    const error = (await new ClientRequest({ fetch: mockFetch(response) })
      .get('/x')
      .catch((e: unknown) => e)) as ApiError
    expect(error.data).toEqual({ code: 'SLOW', retry_after: 7 })
  })

  it('omits retry_after for invalid headers and non-object bodies', async () => {
    const response = new Response('plain', { status: 429, headers: { 'Retry-After': '-3' } })
    const error = (await new ClientRequest({ fetch: mockFetch(response) })
      .get('/x')
      .catch((e: unknown) => e)) as ApiError
    expect(error.data).toEqual({ retry_after: undefined })
    const arrayResponse = new Response('[1]', { status: 429 })
    const arrayError = (await new ClientRequest({ fetch: mockFetch(arrayResponse) })
      .get('/x')
      .catch((e: unknown) => e)) as ApiError
    expect(arrayError.data).toEqual({ retry_after: undefined })
  })

  it('adds retry_after to injected 409 codes only', async () => {
    const config = { retryAfterConflictCodes: ['IN_PROGRESS'] }
    const inProgress = new Response('{"code":"IN_PROGRESS"}', {
      status: 409,
      headers: { 'Retry-After': '3' },
    })
    const other = new Response('{"code":"OTHER"}', { status: 409 })
    const noCode = new Response('{"code":5}', { status: 409 })
    const text = new Response('conflict', { status: 409 })
    const errorOf = async (response: Response) =>
      (await new ClientRequest({ ...config, fetch: mockFetch(response) })
        .get('/x')
        .catch((e: unknown) => e)) as ApiError
    expect((await errorOf(inProgress)).data).toEqual({ code: 'IN_PROGRESS', retry_after: 3 })
    expect((await errorOf(other)).data).toEqual({ code: 'OTHER' })
    expect((await errorOf(noCode)).data).toEqual({ code: 5 })
    expect((await errorOf(text)).data).toBe('conflict')
    const unconfigured = await new ClientRequest({
      fetch: mockFetch(new Response('{"code":"IN_PROGRESS"}', { status: 409 })),
    })
      .get('/x')
      .catch((e: unknown) => e)
    expect((unconfigured as ApiError).data).toEqual({ code: 'IN_PROGRESS' })
  })

  it('wraps network failures in a 500 ApiError', async () => {
    const client = new ClientRequest({ fetch: mockFetch(new Error('offline')) })
    await expect(client.get('/x')).rejects.toMatchObject({
      status: 500,
      message: 'offline (GET /x)',
    })
    const thrown = new ClientRequest({ fetch: vi.fn<typeof fetch>().mockRejectedValue('weird') })
    await expect(thrown.get('/x')).rejects.toMatchObject({ message: 'Unknown error (GET /x)' })
  })

  it('lets aborts propagate unchanged and reports parse failures', async () => {
    const abort = new DOMException('aborted', 'AbortError')
    await expect(new ClientRequest({ fetch: mockFetch(abort) }).get('/x')).rejects.toBe(abort)
    const otherDomError = new DOMException('bad', 'DataError')
    await expect(
      new ClientRequest({ fetch: mockFetch(otherDomError) }).get('/x'),
    ).rejects.toBeInstanceOf(ApiError)
    await expect(
      new ClientRequest({ fetch: mockFetch(new Response('{bad')) }).get('/x'),
    ).rejects.toBeInstanceOf(ApiError)
  })

  it('forwards onError to the error body reader', async () => {
    const onError = vi.fn<(error: unknown) => void>()
    const response = new Response('x', { status: 500, headers: { 'content-length': '999999' } })
    const failure = new Error('cancel failed')
    vi.spyOn(response.body!, 'cancel').mockRejectedValue(failure)
    await new ClientRequest({ fetch: mockFetch(response), onError }).get('/x').catch(() => {})
    expect(onError).toHaveBeenCalledWith(failure)
  })
})
