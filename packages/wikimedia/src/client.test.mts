import { afterEach, describe, expect, it, vi } from 'vitest'

import { createWikimediaClient, WikimediaDecodeError, WikimediaHttpError } from './index.mts'
import type { WikimediaFetch } from './types.mts'

const searchBody = { pages: [{ id: 1, title: 'One' }] }
const summaryBody = { pageid: 1, title: 'One', extract: null, description: null }

afterEach(() => vi.useRealTimers())

function response(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), headers ? { status, headers } : { status })
}

function client(
  fetch: WikimediaFetch,
  options: Partial<Parameters<typeof createWikimediaClient>[0]> = {},
) {
  return createWikimediaClient({
    fetch,
    project: 'wikipedia',
    language: 'en',
    userAgent: 'wikimedia-test/1.0',
    ...options,
  })
}

function deferred<T>(): {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('createWikimediaClient', () => {
  it('uses injected endpoints, fetch, and user agent', async () => {
    const fetch = vi.fn<WikimediaFetch>().mockResolvedValue(response(searchBody))
    await expect(client(fetch).searchByTitle('Ada Lovelace', { limit: 2 })).resolves.toEqual([
      { pageId: 1, title: 'One' },
    ])
    expect(fetch).toHaveBeenCalledWith(
      'https://api.wikimedia.org/core/v1/wikipedia/en/search/title?q=Ada%20Lovelace&limit=2',
      expect.objectContaining({
        headers: { 'user-agent': 'wikimedia-test/1.0' },
        redirect: 'manual',
      }),
    )
  })

  it('maps summary fields and creates a project-specific fallback page URL', async () => {
    const fetch = vi.fn<WikimediaFetch>().mockResolvedValue(response(summaryBody))
    await expect(
      client(fetch, { project: 'wiktionary', language: 'fr' }).getPageSummary('One two'),
    ).resolves.toEqual({
      pageId: 1,
      title: 'One',
      url: 'https://fr.wiktionary.org/wiki/One',
      extract: null,
      description: null,
      thumbnailUrl: null,
    })
    expect(fetch.mock.calls[0]![0]).toBe(
      'https://fr.wiktionary.org/api/rest_v1/page/summary/One%20two',
    )
  })

  it('retries retryable statuses three times and caps Retry-After', async () => {
    vi.useFakeTimers()
    const fetch = vi
      .fn<WikimediaFetch>()
      .mockResolvedValueOnce(response({}, 429, { 'retry-after': '60' }))
      .mockResolvedValueOnce(response(searchBody))
    const pending = client(fetch, { maxRetryDelayMs: 10 }).searchByTitle('one')
    await vi.advanceTimersByTimeAsync(9)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await expect(pending).resolves.toEqual([{ pageId: 1, title: 'One' }])
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('retries only API-server-classified network failures', async () => {
    const reset = Object.assign(new Error('reset'), { code: 'ECONNRESET' })
    const fetch = vi
      .fn<WikimediaFetch>()
      .mockRejectedValueOnce(reset)
      .mockResolvedValueOnce(response(searchBody))
    await expect(client(fetch, { maxRetryDelayMs: 0 }).searchByTitle('one')).resolves.toEqual([
      { pageId: 1, title: 'One' },
    ])
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('keeps body reads and cleanup inside its three-request concurrency limit', async () => {
    const bodyReads = Array.from({ length: 3 }, () => deferred<unknown>())
    const cleanupDone = Array.from({ length: 3 }, () => deferred<void>())
    const cleanup = cleanupDone.map((pending) => vi.fn<() => Promise<void>>(() => pending.promise))
    let call = 0
    const fetch: WikimediaFetch = vi.fn<WikimediaFetch>(() => {
      const index = call++
      if (index === 3) return Promise.resolve(response(searchBody))
      return Promise.resolve({
        status: 200,
        json: vi.fn(() => bodyReads[index]!.promise),
        body: { cancel: cleanup[index]! },
      } as unknown as Response)
    })
    const instance = client(fetch)
    const pending = ['a', 'b', 'c', 'd'].map((query) => instance.searchByTitle(query))
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))
    bodyReads[0]!.resolve(searchBody)
    await vi.waitFor(() => expect(cleanup[0]).toHaveBeenCalledOnce())
    expect(fetch).toHaveBeenCalledTimes(3)
    cleanupDone[0]!.resolve()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(4))
    for (const bodyRead of bodyReads.slice(1)) bodyRead.resolve(searchBody)
    for (const done of cleanupDone.slice(1)) done.resolve()
    await expect(Promise.all(pending)).resolves.toHaveLength(4)
  })

  it('rejects queued and active caller aborts without a retry', async () => {
    const active = Array.from({ length: 5 }, () => deferred<Response>())
    let call = 0
    const fetch: WikimediaFetch = vi.fn<WikimediaFetch>((_url, init) => {
      const pending = active[call++]!
      init.signal?.addEventListener('abort', () =>
        pending?.reject(new DOMException('aborted', 'AbortError')),
      )
      return pending!.promise
    })
    const instance = client(fetch)
    const occupying = ['a', 'b', 'c'].map((query) => instance.searchByTitle(query))
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))
    const queued = new AbortController()
    const queuedRequest = instance.searchByTitle('queued', { signal: queued.signal })
    const retainedRequest = instance.searchByTitle('retained')
    const queuedText = new AbortController()
    const queuedTextRequest = instance.searchByTitle('queued text', { signal: queuedText.signal })
    const queuedError = new Error('queued abort')
    queued.abort(queuedError)
    await expect(queuedRequest).rejects.toBe(queuedError)
    queuedText.abort('queued supplied text')
    await expect(queuedTextRequest).rejects.toMatchObject({ name: 'AbortError' })
    active[0]!.resolve(response(searchBody))
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(4))
    active[3]!.resolve(response(searchBody))
    await expect(retainedRequest).resolves.toEqual([{ pageId: 1, title: 'One' }])
    const activeAbort = new AbortController()
    const activeRequest = instance.searchByTitle('active', { signal: activeAbort.signal })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(5))
    const activeError = new Error('active abort')
    activeAbort.abort(activeError)
    await expect(activeRequest).rejects.toBe(activeError)
    for (const request of active.slice(1, 3)) request.resolve(response(searchBody))
    await expect(Promise.all(occupying)).resolves.toHaveLength(3)
    expect(fetch).toHaveBeenCalledTimes(5)
  })

  it('retries internal timeouts but not caller aborts during backoff', async () => {
    vi.useFakeTimers()
    const fetch = vi
      .fn<WikimediaFetch>()
      .mockImplementationOnce(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('timeout', 'AbortError')),
            )
          }),
      )
      .mockResolvedValueOnce(response(searchBody))
    const timed = client(fetch, { timeoutMs: 5, maxRetryDelayMs: 0 }).searchByTitle('one')
    await vi.advanceTimersByTimeAsync(5)
    await expect(timed).resolves.toEqual([{ pageId: 1, title: 'One' }])
    const retrying = vi
      .fn<WikimediaFetch>()
      .mockResolvedValue(response({}, 500, { 'retry-after': '60' }))
    const controller = new AbortController()
    const aborted = client(retrying).searchByTitle('one', { signal: controller.signal })
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    await expect(aborted).rejects.toThrow(/abort/i)
    expect(retrying).toHaveBeenCalledTimes(1)
  })

  it('releases an ignored timed-out fetch and cleans its late response', async () => {
    vi.useFakeTimers()
    const late = deferred<Response>()
    const cancel = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    const fetch = vi
      .fn<WikimediaFetch>()
      .mockReturnValueOnce(late.promise)
      .mockResolvedValueOnce(response(searchBody))
    const pending = client(fetch, { timeoutMs: 5, maxRetryDelayMs: 0 }).searchByTitle('one')
    await vi.advanceTimersByTimeAsync(5)
    await expect(pending).resolves.toEqual([{ pageId: 1, title: 'One' }])
    late.resolve({ status: 200, body: { cancel } } as unknown as Response)
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce())
  })

  it('times out stalled body reads and retries retryable body failures', async () => {
    vi.useFakeTimers()
    const stalled = deferred<unknown>()
    const cancel = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    const stalledResponse = {
      status: 200,
      json: vi.fn(() => stalled.promise),
      body: { cancel },
    } as unknown as Response
    const fetch = vi
      .fn<WikimediaFetch>()
      .mockResolvedValueOnce(stalledResponse)
      .mockResolvedValueOnce(response(searchBody))
    const timed = client(fetch, { timeoutMs: 5, maxRetryDelayMs: 0 }).searchByTitle('one')
    await vi.advanceTimersByTimeAsync(5)
    await expect(timed).resolves.toEqual([{ pageId: 1, title: 'One' }])
    expect(cancel).toHaveBeenCalledOnce()
    stalled.resolve(searchBody)
    await Promise.resolve()
    const reset = Object.assign(new Error('reset'), { code: 'ECONNRESET' })
    const retrying = vi
      .fn<WikimediaFetch>()
      .mockResolvedValueOnce({
        status: 200,
        json: vi.fn().mockRejectedValue(reset),
        body: null,
      } as unknown as Response)
      .mockResolvedValueOnce(response(searchBody))
    await expect(client(retrying, { maxRetryDelayMs: 0 }).searchByTitle('one')).resolves.toEqual([
      { pageId: 1, title: 'One' },
    ])
  })

  it('cancels stalled body reads when the caller aborts', async () => {
    const stalled = deferred<unknown>()
    const cancel = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    const fetch = vi.fn<WikimediaFetch>().mockResolvedValue({
      status: 200,
      json: vi.fn(() => stalled.promise),
      body: { cancel },
    } as unknown as Response)
    const controller = new AbortController()
    const pending = client(fetch).searchByTitle('one', { signal: controller.signal })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    controller.abort('caller supplied text')
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('normalizes an abort between fetch settlement and body consumption', async () => {
    const controller = new AbortController()
    const cancel = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    const fetch: WikimediaFetch = vi.fn(() => {
      const settled = Promise.resolve({
        status: 200,
        json: vi.fn().mockResolvedValue(searchBody),
        body: { cancel },
      } as unknown as Response)
      void settled.then(() => queueMicrotask(() => controller.abort('between phases')))
      return settled
    })
    await expect(
      client(fetch).searchByTitle('one', { signal: controller.signal }),
    ).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('cleans response bodies and exposes terminal status and decoding errors', async () => {
    const cancel = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    const badJson = {
      status: 200,
      json: vi.fn().mockRejectedValue(new SyntaxError()),
      body: { cancel },
    } as unknown as Response
    await expect(
      client(vi.fn<WikimediaFetch>().mockResolvedValue(badJson)).searchByTitle('one'),
    ).rejects.toBeInstanceOf(WikimediaDecodeError)
    expect(cancel).toHaveBeenCalledOnce()
    await expect(
      client(vi.fn<WikimediaFetch>().mockResolvedValue(response({}, 302))).searchByTitle('one'),
    ).rejects.toEqual(
      expect.objectContaining({
        status: 302,
        url: expect.stringContaining('/search/title'),
      }) as WikimediaHttpError,
    )
    await expect(
      client(vi.fn<WikimediaFetch>().mockResolvedValue(response({}, 404))).getPageSummary('none'),
    ).resolves.toBeNull()
    await expect(
      client(vi.fn<WikimediaFetch>().mockResolvedValue(response({ pages: [{}] }))).searchByTitle(
        'one',
      ),
    ).rejects.toBeInstanceOf(WikimediaDecodeError)
  })

  it('rejects malformed strict payload fields', async () => {
    const malformedSearch = { pages: [{ id: 1.5, title: '' }] }
    await expect(
      client(vi.fn<WikimediaFetch>().mockResolvedValue(response(malformedSearch))).searchByTitle(
        'one',
      ),
    ).rejects.toBeInstanceOf(WikimediaDecodeError)
    for (const malformedSummary of [
      { pageid: Number.MAX_SAFE_INTEGER + 1, title: 'One' },
      { pageid: 1, title: '', thumbnail: { source: 'https://example.test/one.png' } },
      { pageid: 1, title: 'One', content_urls: [] },
      { pageid: 1, title: 'One', content_urls: { desktop: { page: '' } } },
      { pageid: 1, title: 'One', thumbnail: {} },
    ]) {
      await expect(
        client(
          vi.fn<WikimediaFetch>().mockResolvedValue(response(malformedSummary)),
        ).getPageSummary('one'),
      ).rejects.toBeInstanceOf(WikimediaDecodeError)
    }
  })

  it('validates client configuration and request inputs before fetching', async () => {
    const fetch = vi.fn<WikimediaFetch>()
    expect(() => client(fetch, { project: 'not.a-label' })).toThrow(/project/)
    expect(() => client(fetch, { timeoutMs: Number.POSITIVE_INFINITY })).toThrow(/timeoutMs/)
    expect(() => client(fetch, { maxRetryDelayMs: -1 })).toThrow(/maxRetryDelayMs/)
    const instance = client(fetch)
    await expect(instance.searchByTitle('one', { limit: 101 })).rejects.toThrow(/limit/)
    await expect(instance.getPageSummary('   ')).rejects.toThrow(/title/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects non-string optional summary text fields', async () => {
    await expect(
      client(
        vi
          .fn<WikimediaFetch>()
          .mockResolvedValue(response({ pageid: 1, title: 'One', extract: 1 })),
      ).getPageSummary('one'),
    ).rejects.toBeInstanceOf(WikimediaDecodeError)
  })

  it('accepts populated summary URLs and rejects malformed root payloads', async () => {
    await expect(
      client(
        vi.fn<WikimediaFetch>().mockResolvedValue(
          response({
            pageid: 1,
            title: 'One',
            content_urls: { desktop: { page: 'https://example.test/one' } },
            thumbnail: { source: 'https://example.test/one.png' },
            extract: 'Extract',
            description: 'Description',
          }),
        ),
      ).getPageSummary('one'),
    ).resolves.toMatchObject({
      url: 'https://example.test/one',
      thumbnailUrl: 'https://example.test/one.png',
    })
    await expect(
      client(vi.fn<WikimediaFetch>().mockResolvedValue(response(null))).searchByTitle('one'),
    ).rejects.toBeInstanceOf(WikimediaDecodeError)
    await expect(
      client(vi.fn<WikimediaFetch>().mockResolvedValue(response({}))).searchByTitle('one'),
    ).rejects.toBeInstanceOf(WikimediaDecodeError)
  })

  it('honors pre-aborted calls and ignores response cleanup failures', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      client(vi.fn<WikimediaFetch>()).searchByTitle('one', { signal: controller.signal }),
    ).rejects.toThrow(/abort/i)
    const cancel = vi.fn<() => Promise<void>>().mockRejectedValue(new Error('cleanup failed'))
    await expect(
      client(
        vi.fn<WikimediaFetch>().mockResolvedValue({
          status: 200,
          json: vi.fn().mockResolvedValue(searchBody),
          body: { cancel },
        } as unknown as Response),
      ).searchByTitle('one'),
    ).resolves.toEqual([{ pageId: 1, title: 'One' }])
  })

  it('handles synchronous fetch failures and exponential retry delays', async () => {
    const thrown = new Error('fetch threw')
    await expect(
      client(
        vi.fn<WikimediaFetch>(() => {
          throw thrown
        }),
      ).searchByTitle('one'),
    ).rejects.toBe(thrown)
    vi.useFakeTimers()
    const fetch = vi
      .fn<WikimediaFetch>()
      .mockResolvedValueOnce(response({}, 500))
      .mockResolvedValueOnce(response(searchBody))
    const pending = client(fetch, { maxRetryDelayMs: 1_000 }).searchByTitle('one')
    await vi.advanceTimersByTimeAsync(249)
    expect(fetch).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    await expect(pending).resolves.toEqual([{ pageId: 1, title: 'One' }])
  })
})
