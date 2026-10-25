// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import * as subpath from './paginated-list.mts'
import { usePaginatedList } from './paginated-list.mts'
import { appendPaginatedPage, PaginatedRequestLifecycle } from './paginated-list-utils.mts'

type Page = {
  results: { id: string }[]
  page_info: { has_next_page: boolean; end_cursor: string | null }
}

function page(ids: string[], endCursor: string | null): Page {
  return {
    results: ids.map((id) => ({ id })),
    page_info: { has_next_page: endCursor !== null, end_cursor: endCursor },
  }
}

function ids(pages: Page[]): string[] {
  return pages.flatMap((p) => p.results.map((r) => r.id))
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function setup(fetchPage: (endpoint: string, params: { after?: string }) => Promise<Page>) {
  const initial = page(['a1'], 'c1')
  return renderHook(() => usePaginatedList(initial, '/items', {}, { fetchPage }))
}

async function loadPages(result: { current: ReturnType<typeof usePaginatedList<Page>> }) {
  await act(async () => {
    await result.current.loadMore()
  })
}

describe('public lifecycle exports', () => {
  it('exposes the request lifecycle and append helper from the subpath', () => {
    expect(subpath.PaginatedRequestLifecycle).toBe(PaginatedRequestLifecycle)
    expect(subpath.appendPaginatedPage).toBe(appendPaginatedPage)
  })
})

describe('refreshLoadedPages', () => {
  it('re-reads every loaded page by following cursors and swaps them in at once', async () => {
    const server: Record<string, Page> = {
      c1: page(['a2'], 'c2'),
      c2: page(['a3'], null),
    }
    const fetchPage = vi.fn(
      async (_endpoint: string, params: { after?: string }) => server[params.after!]!,
    )
    const { result } = setup(fetchPage)
    await loadPages(result)
    await loadPages(result)
    expect(ids(result.current.pages)).toEqual(['a1', 'a2', 'a3'])

    server.c1 = page(['a2', 'a2b'], 'c2')
    server.c2 = page(['a3x'], null)
    fetchPage.mockClear()
    const fetchFirst = vi.fn(async () => page(['new', 'a1'], 'c1'))
    await act(async () => {
      await result.current.refreshLoadedPages(fetchFirst)
    })

    expect(fetchFirst).toHaveBeenCalledTimes(1)
    expect(fetchPage.mock.calls.map(([, params]) => params.after)).toEqual(['c1', 'c2'])
    expect(result.current.pages).toHaveLength(3)
    expect(ids(result.current.pages)).toEqual(['new', 'a1', 'a2', 'a2b', 'a3x'])
    expect(result.current.fetchError).toBeNull()
  })

  it('stops following cursors once the server reports no further page', async () => {
    const fetchPage = vi.fn(async () => page(['a2'], null))
    const { result } = setup(fetchPage)
    await loadPages(result)
    fetchPage.mockClear()
    await act(async () => {
      await result.current.refreshLoadedPages(async () => page(['a1'], null))
    })
    expect(fetchPage).not.toHaveBeenCalled()
    expect(result.current.pages).toHaveLength(1)
  })

  it('keeps pages appended by a concurrent loadMore without duplicates', async () => {
    const firstPage = deferred<Page>()
    const fetchPage = vi.fn(async (_endpoint: string, params: { after?: string }) =>
      params.after === 'c1' ? page(['a2'], 'c2') : page(['a3', 'a2'], null),
    )
    const { result } = setup(fetchPage)
    await loadPages(result)

    let refresh!: Promise<void>
    act(() => {
      refresh = result.current.refreshLoadedPages(() => firstPage.promise)
    })
    await loadPages(result)
    expect(ids(result.current.pages)).toEqual(['a1', 'a2', 'a3'])

    await act(async () => {
      firstPage.resolve(page(['a1', 'a0'], 'c1'))
      await refresh
    })
    expect(ids(result.current.pages)).toEqual(['a1', 'a0', 'a2', 'a3'])
  })

  it('discards a refresh superseded by a newer refresh', async () => {
    const { result } = setup(vi.fn(async () => page(['a2'], null)))
    await loadPages(result)
    const older = deferred<Page>()
    const newer = deferred<Page>()

    let first!: Promise<void>
    let second!: Promise<void>
    act(() => {
      first = result.current.refreshLoadedPages(() => older.promise)
      second = result.current.refreshLoadedPages(() => newer.promise)
    })
    await act(async () => {
      newer.resolve(page(['n1'], null))
      await second
    })
    await act(async () => {
      older.resolve(page(['o1'], null))
      await first
    })
    expect(ids(result.current.pages)).toEqual(['n1'])

    const failure = deferred<Page>()
    let failing!: Promise<void>
    act(() => {
      failing = result.current.refreshLoadedPages(() => failure.promise)
    })
    await act(async () => {
      await result.current.refreshLoadedPages(async () => page(['n2'], null))
      failure.reject(new Error('stale failure'))
      await failing
    })
    expect(ids(result.current.pages)).toEqual(['n2'])
    expect(result.current.fetchError).toBeNull()
  })

  it('discards a refresh superseded by a reset', async () => {
    const { result } = setup(vi.fn(async () => page([], null)))
    const slow = deferred<Page>()
    let refresh!: Promise<void>
    act(() => {
      refresh = result.current.refreshLoadedPages(() => slow.promise)
    })
    act(() => {
      result.current.resetToFirstPage(page(['r1'], null))
    })
    await act(async () => {
      slow.resolve(page(['stale'], null))
      await refresh
    })
    expect(ids(result.current.pages)).toEqual(['r1'])

    const failure = deferred<Page>()
    act(() => {
      refresh = result.current.refreshLoadedPages(() => failure.promise)
    })
    act(() => {
      result.current.resetToFirstPage(page(['r2'], null))
    })
    await act(async () => {
      failure.reject(new Error('late'))
      await refresh
    })
    expect(ids(result.current.pages)).toEqual(['r2'])
    expect(result.current.fetchError).toBeNull()
  })

  it('keeps existing pages and surfaces the error when a refresh fails', async () => {
    const { result } = setup(vi.fn(async () => page(['a2'], null)))
    await loadPages(result)

    const failure = new Error('refresh failed')
    await act(async () => {
      await result.current.refreshLoadedPages(async () => {
        throw failure
      })
    })
    expect(ids(result.current.pages)).toEqual(['a1', 'a2'])
    expect(result.current.fetchError).toBe(failure)

    await act(async () => {
      await result.current.refreshLoadedPages(() => Promise.reject('boom'))
    })
    expect(result.current.fetchError?.message).toBe('Failed to refresh')
    expect(ids(result.current.pages)).toEqual(['a1', 'a2'])

    await act(async () => {
      await result.current.refreshLoadedPages(async () => page(['a1'], 'c1'))
    })
    expect(result.current.fetchError).toBeNull()
  })

  it('fetches continuation pages through loadPage when no fetchPage is given', async () => {
    const loadPage = vi.fn(async () => page(['a2'], null))
    const initial = page(['a1'], 'c1')
    const { result } = renderHook(() => usePaginatedList(initial, '/items', {}, { loadPage }))
    await loadPages(result)
    loadPage.mockClear()
    await act(async () => {
      await result.current.refreshLoadedPages(async () => page(['a1'], 'c1'))
    })
    expect(loadPage).toHaveBeenCalledWith('c1')
  })
})
