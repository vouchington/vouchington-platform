import { describe, expect, it, vi } from 'vitest'
import { createRedirectingFetch, RedirectFetchError } from './redirecting-fetch.mts'

const dispatcher = {} as NonNullable<RequestInit['dispatcher']>

describe('createRedirectingFetch', () => {
  it('resolves and pins every redirect hop', async () => {
    const resolveDestination = vi.fn().mockResolvedValue({ dispatcher })
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/next' } }))
      .mockResolvedValueOnce(new Response('ok'))
    const safeFetch = createRedirectingFetch({ fetch, resolveDestination, maxRedirects: 1 })

    await expect(safeFetch('https://public.example/start')).resolves.toMatchObject({ status: 200 })
    expect(resolveDestination).toHaveBeenNthCalledWith(
      1,
      new URL('https://public.example/start'),
      undefined,
    )
    expect(resolveDestination).toHaveBeenNthCalledWith(
      2,
      new URL('https://public.example/next'),
      undefined,
    )
    expect(fetch).toHaveBeenNthCalledWith(1, new URL('https://public.example/start'), {
      dispatcher,
      headers: expect.any(Headers),
      redirect: 'manual',
    })
    expect(fetch).toHaveBeenNthCalledWith(2, new URL('https://public.example/next'), {
      dispatcher,
      headers: expect.any(Headers),
      redirect: 'manual',
    })
  })

  it('preserves same-origin credentials but strips them permanently after a cross-origin redirect', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/same' } }))
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: 'https://other.example/' } }),
      )
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: 'https://public.example/end' } }),
      )
      .mockResolvedValueOnce(new Response('ok'))
    const safeFetch = createRedirectingFetch({
      fetch,
      resolveDestination: vi.fn().mockResolvedValue({ dispatcher }),
    })

    await safeFetch('https://public.example/start', {
      credentials: 'include',
      headers: {
        Accept: 'text/plain',
        Authorization: 'Bearer secret',
        Cookie: 'a=b',
        'Proxy-Authorization': 'proxy',
        'X-Api-Key': 'custom-secret',
        X: '1',
      },
    })

    const requests = fetch.mock.calls.map(([, init]) => init as RequestInit)
    expect((requests[0]!.headers as Headers).get('authorization')).toBe('Bearer secret')
    expect((requests[1]!.headers as Headers).get('cookie')).toBe('a=b')
    expect(requests[1]!.credentials).toBe('include')
    for (const request of requests.slice(2)) {
      const headers = request.headers as Headers
      expect(headers.get('authorization')).toBeNull()
      expect(headers.get('cookie')).toBeNull()
      expect(headers.get('proxy-authorization')).toBeNull()
      expect(headers.get('x-api-key')).toBeNull()
      expect(headers.get('x')).toBeNull()
      expect(headers.get('accept')).toBe('text/plain')
      expect(request.credentials).toBe('omit')
    }
  })

  it('awaits cleanup and contains cancellation errors before following redirects', async () => {
    let cancelled = false
    const body = new ReadableStream({
      cancel: () =>
        Promise.resolve().then(() => {
          cancelled = true
        }),
    })
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(body, { status: 302, headers: { location: '/next' } }))
      .mockImplementationOnce(() => {
        expect(cancelled).toBe(true)
        return Promise.resolve(new Response('ok'))
      })
    const safeFetch = createRedirectingFetch({
      fetch,
      resolveDestination: vi.fn().mockResolvedValue({ dispatcher }),
    })
    await expect(safeFetch('https://example.com')).resolves.toMatchObject({ status: 200 })

    const failingBody = new ReadableStream({
      cancel: () => Promise.reject(new Error('already closed')),
    })
    const failingFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(failingBody, { status: 302, headers: { location: '/next' } }),
      )
      .mockResolvedValueOnce(new Response('ok'))
    await expect(
      createRedirectingFetch({
        fetch: failingFetch,
        resolveDestination: vi.fn().mockResolvedValue({ dispatcher }),
      })('https://example.com'),
    ).resolves.toMatchObject({ status: 200 })
  })

  it('rejects unsafe request and redirect inputs', async () => {
    const safeFetch = createRedirectingFetch({ fetch: vi.fn(), resolveDestination: vi.fn() })
    await expect(safeFetch('not a URL')).rejects.toThrow('Invalid URL')
    await expect(safeFetch('ftp://example.com')).rejects.toThrow('HTTP or HTTPS')
    await expect(safeFetch('https://example.com', { method: 'POST' })).rejects.toThrow(
      'GET and HEAD',
    )
    await expect(safeFetch('https://example.com', { redirect: 'follow' })).rejects.toThrow(
      'omitted or manual',
    )
  })

  it('rejects malformed redirects and redirect limits', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 302 }))
    const safeFetch = createRedirectingFetch({
      fetch,
      resolveDestination: vi.fn().mockResolvedValue({ dispatcher }),
    })
    await expect(safeFetch('https://example.com')).rejects.toBeInstanceOf(RedirectFetchError)
    const malformedFetch = createRedirectingFetch({
      fetch: vi
        .fn()
        .mockResolvedValue(
          new Response(null, { status: 302, headers: { location: 'http://[invalid' } }),
        ),
      resolveDestination: vi.fn().mockResolvedValue({ dispatcher }),
    })
    await expect(malformedFetch('https://example.com')).rejects.toBeInstanceOf(RedirectFetchError)
    expect(() =>
      createRedirectingFetch({ fetch, resolveDestination: vi.fn(), maxRedirects: -1 }),
    ).toThrow(RangeError)
  })

  it('stops at the configured redirect limit', async () => {
    const response = new Response(null, { status: 302, headers: { location: '/again' } })
    const safeFetch = createRedirectingFetch({
      fetch: vi.fn().mockResolvedValue(response),
      resolveDestination: vi.fn().mockResolvedValue({ dispatcher }),
      maxRedirects: 0,
    })
    await expect(safeFetch('https://example.com')).rejects.toThrow('Exceeded 0 redirects')
  })
})
