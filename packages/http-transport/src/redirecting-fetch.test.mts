import { describe, expect, it, vi } from 'vitest'
import { createRedirectingFetch, RedirectFetchError } from './redirecting-fetch.mts'

describe('createRedirectingFetch', () => {
  it('resolves and pins every redirect hop', async () => {
    const resolveDestination = vi
      .fn()
      .mockResolvedValueOnce({ dispatcher: 'one' })
      .mockResolvedValueOnce({ dispatcher: 'two' })
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
      dispatcher: 'one',
      redirect: 'manual',
    })
    expect(fetch).toHaveBeenNthCalledWith(2, new URL('https://public.example/next'), {
      dispatcher: 'two',
      redirect: 'manual',
    })
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
      resolveDestination: vi.fn().mockResolvedValue({}),
    })
    await expect(safeFetch('https://example.com')).rejects.toBeInstanceOf(RedirectFetchError)
    expect(() =>
      createRedirectingFetch({ fetch, resolveDestination: vi.fn(), maxRedirects: -1 }),
    ).toThrow(RangeError)
  })

  it('stops at the configured redirect limit', async () => {
    const response = new Response(null, { status: 302, headers: { location: '/again' } })
    const safeFetch = createRedirectingFetch({
      fetch: vi.fn().mockResolvedValue(response),
      resolveDestination: vi.fn().mockResolvedValue({}),
      maxRedirects: 0,
    })
    await expect(safeFetch('https://example.com')).rejects.toThrow('Exceeded 0 redirects')
  })
})
