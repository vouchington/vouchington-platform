import { describe, expect, it, vi } from 'vitest'
import { ClientRequest } from './client-request.mts'
import { applyBody, appendQuery, mergeHeaders } from './request-parts.mts'

describe('mergeHeaders', () => {
  it('lets later sources win case-insensitively and keeps their casing', () => {
    expect(
      mergeHeaders({ Authorization: 'a', 'X-One': '1' }, undefined, { authorization: 'b' }),
    ).toEqual({ 'X-One': '1', authorization: 'b' })
  })
})

describe('appendQuery', () => {
  it('starts, extends, and places queries before fragments', () => {
    expect(appendQuery('/a', '')).toBe('/a')
    expect(appendQuery('/a', '?x=1')).toBe('/a?x=1')
    expect(appendQuery('/a?s=top', '?x=1')).toBe('/a?s=top&x=1')
    expect(appendQuery('/a?', '?x=1')).toBe('/a?x=1')
    expect(appendQuery('/a?s=1&', '?x=1')).toBe('/a?s=1&x=1')
    expect(appendQuery('/a#frag', '?x=1')).toBe('/a?x=1#frag')
  })
})

describe('applyBody', () => {
  it.each([false, 0, '', null])('serializes the falsy body %j', (body) => {
    const init: RequestInit = {}
    applyBody(init, 'POST', body, {})
    expect(init.body).toBe(JSON.stringify(body))
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
  })

  it('omits the body and content type for undefined bodies and GET', () => {
    const post: RequestInit = {}
    applyBody(post, 'POST', undefined, { A: '1' })
    expect(post).toEqual({ headers: { A: '1' } })
    const get: RequestInit = {}
    applyBody(get, 'GET', { ignored: true }, {})
    expect(get).toEqual({ headers: {} })
  })

  it('lets callers override the content type regardless of case', () => {
    const init: RequestInit = {}
    applyBody(init, 'PUT', {}, { 'content-type': 'application/merge-patch+json' })
    expect(init.headers).toEqual({ 'content-type': 'application/merge-patch+json' })
  })
})

describe('verb helpers', () => {
  const okFetch = () => vi.fn<typeof fetch>(async () => new Response('{}'))

  it('keeps the helper method and body even if shared options carry others', async () => {
    const fetchMock = okFetch()
    const client = new ClientRequest({ fetch: fetchMock })
    const sharedOptions = { method: 'DELETE', body: 'wrong', headers: { A: '1' } }
    await client.post('/a', { ok: 1 }, sharedOptions as never)
    await client.delete('/a', sharedOptions as never)
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'POST', body: '{"ok":1}' })
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({ method: 'DELETE' })
  })

  it('appends search params to endpoints that already have a query', async () => {
    const fetchMock = okFetch()
    await new ClientRequest({ fetch: fetchMock }).get('/a?sort=top', { searchParams: { limit: 2 } })
    expect(fetchMock.mock.calls[0]![0]).toBe('/a?sort=top&limit=2')
  })

  it('merges injected and per-call headers case-insensitively', async () => {
    const fetchMock = okFetch()
    const client = new ClientRequest({
      fetch: fetchMock,
      headers: () => ({ Authorization: 'inj' }),
    })
    await client.post(
      '/a',
      {},
      { headers: { authorization: 'call', 'content-type': 'text/plain' } },
    )
    expect(fetchMock.mock.calls[0]![1]?.headers).toEqual({
      authorization: 'call',
      'content-type': 'text/plain',
    })
  })
})
