import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
// @vitest-environment jsdom
import { usePaginatedList as useList, type UsePaginatedListOptions } from './paginated-list.mts'
import type { PaginatedData, PaginatedListParams } from './paginated-query-key.mts'

const getPaginatedPage = vi.fn<(endpoint: string, params: PaginatedListParams) => Promise<any>>()

function usePaginatedList<T extends PaginatedData>(
  initial: T,
  endpoint: string,
  params: PaginatedListParams,
  options?: UsePaginatedListOptions<T>,
) {
  return useList(initial, endpoint, params, options ?? { fetchPage: getPaginatedPage })
}
import { getPaginatedQueryKey } from './paginated-query-key.mts'

interface TestPage {
  items: string[]
  page_info: {
    has_next_page: boolean
    end_cursor: string | null
    start_cursor: string | null
  }
}

interface EntityPage {
  results: { id: string; label: string }[]
  page_info: TestPage['page_info']
}

function makePage(items: string[], endCursor: string | null): TestPage {
  return {
    items,
    page_info: {
      has_next_page: endCursor !== null,
      end_cursor: endCursor,
      start_cursor: null,
    },
  }
}

describe('usePaginatedList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deduplicates appended results by stable ID', async () => {
    const initial: EntityPage = {
      results: [
        { id: 'one', label: 'One' },
        { id: 'two', label: 'Two' },
      ],
      page_info: {
        has_next_page: true,
        end_cursor: 'cursor',
        start_cursor: null,
      },
    }
    const nextPage: EntityPage = {
      results: [
        { id: 'two', label: 'Two duplicate' },
        { id: 'three', label: 'Three' },
      ],
      page_info: {
        has_next_page: false,
        end_cursor: null,
        start_cursor: null,
      },
    }
    vi.mocked(getPaginatedPage).mockResolvedValueOnce(nextPage)
    const { result } = renderHook(() =>
      usePaginatedList(initial, '/api/v1/items', { filter: 'same' }),
    )

    await act(async () => {
      await result.current.loadMore()
    })
    expect(result.current.pages).toEqual([
      initial,
      { ...nextPage, results: [{ id: 'three', label: 'Three' }] },
    ])
  })

  it('starts only one continuation request while the first remains pending', async () => {
    let resolvePage!: (page: TestPage) => void
    vi.mocked(getPaginatedPage).mockImplementationOnce(
      () => new Promise<TestPage>((resolve) => (resolvePage = resolve)),
    )
    const initial = makePage(['first'], 'cursor')
    const { result } = renderHook(() =>
      usePaginatedList(initial, '/api/v1/items', { filter: 'same' }),
    )

    let firstRequest!: Promise<void | boolean>
    let secondRequest!: Promise<void | boolean>
    act(() => {
      firstRequest = result.current.loadMore()
      secondRequest = result.current.loadMore()
    })

    expect(getPaginatedPage).toHaveBeenCalledTimes(1)
    expect(result.current.loadingMore).toBe(true)
    await act(async () => {
      resolvePage(makePage(['second'], null))
      await Promise.all([firstRequest, secondRequest])
    })
    expect(result.current.pages).toEqual([initial, makePage(['second'], null)])
    // Only the request that actually claimed the lifecycle token resolves `true`; the
    // concurrent second call is turned away by `start()` before any fetch and resolves `false`.
    await expect(firstRequest).resolves.toBe(true)
    await expect(secondRequest).resolves.toBe(false)
  })

  it('ignores an A request that resolves after A to B to A before a fresh A request', async () => {
    let resolveStale!: (page: TestPage) => void
    vi.mocked(getPaginatedPage).mockImplementationOnce(
      () => new Promise<TestPage>((resolve) => (resolveStale = resolve)),
    )
    const firstInitial = makePage(['first-1'], 'first-cursor')
    const secondInitial = makePage(['second-1'], 'second-cursor')
    const { result, rerender } = renderHook(
      ({ initialData, filter }: { initialData: TestPage; filter: string }) =>
        usePaginatedList(initialData, '/api/v1/items', { filter }),
      { initialProps: { initialData: firstInitial, filter: 'first' } },
    )

    let staleRequest!: Promise<void | boolean>
    act(() => {
      staleRequest = result.current.loadMore()
    })
    rerender({ initialData: secondInitial, filter: 'second' })
    rerender({ initialData: firstInitial, filter: 'first' })

    await act(async () => {
      resolveStale(makePage(['stale-first-2'], null))
      await staleRequest
    })

    expect(result.current.pages).toEqual([firstInitial])
    expect(result.current.loadingMore).toBe(false)

    const freshPage = makePage(['fresh-first-2'], null)
    vi.mocked(getPaginatedPage).mockResolvedValueOnce(freshPage)
    await act(async () => result.current.loadMore())
    expect(result.current.pages).toEqual([firstInitial, freshPage])
  })

  it('starts a fresh request after switching from A to B and back to A', async () => {
    let resolveStale!: (page: TestPage) => void
    let resolveFresh!: (page: TestPage) => void
    vi.mocked(getPaginatedPage)
      .mockImplementationOnce(() => new Promise<TestPage>((resolve) => (resolveStale = resolve)))
      .mockImplementationOnce(() => new Promise<TestPage>((resolve) => (resolveFresh = resolve)))
    const firstInitial = makePage(['first-1'], 'first-cursor')
    const secondInitial = makePage(['second-1'], 'second-cursor')
    const { result, rerender } = renderHook(
      ({ initialData, filter }: { initialData: TestPage; filter: string }) =>
        usePaginatedList(initialData, '/api/v1/items', { filter }),
      { initialProps: { initialData: firstInitial, filter: 'first' } },
    )

    let staleRequest!: Promise<void | boolean>
    act(() => {
      staleRequest = result.current.loadMore()
    })
    rerender({ initialData: secondInitial, filter: 'second' })
    rerender({ initialData: firstInitial, filter: 'first' })

    let freshRequest!: Promise<void | boolean>
    act(() => {
      freshRequest = result.current.loadMore()
    })
    expect(getPaginatedPage).toHaveBeenCalledTimes(2)

    await act(async () => {
      resolveStale(makePage(['stale-first-2'], null))
      await staleRequest
    })
    expect(result.current.pages).toEqual([firstInitial])

    const freshPage = makePage(['fresh-first-2'], null)
    await act(async () => {
      resolveFresh(freshPage)
      await freshRequest
    })
    expect(result.current.pages).toEqual([firstInitial, freshPage])
  })

  it('loads a new query while the previous query request is pending and ignores its completion', async () => {
    let resolveFirst!: (page: TestPage) => void
    let resolveSecond!: (page: TestPage) => void
    vi.mocked(getPaginatedPage)
      .mockImplementationOnce(() => new Promise<TestPage>((resolve) => (resolveFirst = resolve)))
      .mockImplementationOnce(() => new Promise<TestPage>((resolve) => (resolveSecond = resolve)))
    const firstInitial = makePage(['first-1'], 'first-cursor')
    const secondInitial = makePage(['second-1'], 'second-cursor')
    const { result, rerender } = renderHook(
      ({ initialData, filter }: { initialData: TestPage; filter: string }) =>
        usePaginatedList(initialData, '/api/v1/items', { filter }),
      { initialProps: { initialData: firstInitial, filter: 'first' } },
    )

    let firstRequest!: Promise<void | boolean>
    act(() => {
      firstRequest = result.current.loadMore()
    })
    rerender({ initialData: secondInitial, filter: 'second' })
    expect(result.current.pages).toEqual([secondInitial])
    expect(result.current.loadingMore).toBe(false)

    let secondRequest!: Promise<void | boolean>
    act(() => {
      secondRequest = result.current.loadMore()
    })
    expect(getPaginatedPage).toHaveBeenLastCalledWith('/api/v1/items', {
      filter: 'second',
      after: 'second-cursor',
    })

    await act(async () => {
      resolveFirst(makePage(['first-2'], null))
      await firstRequest
    })
    expect(result.current.pages).toEqual([secondInitial])

    const secondPage = makePage(['second-2'], null)
    await act(async () => {
      resolveSecond(secondPage)
      await secondRequest
    })
    expect(result.current.pages).toEqual([secondInitial, secondPage])
  })

  it('preserves accumulated pages when page one refreshes for the same query', async () => {
    const initial = makePage(['first-version'], 'cursor')
    const nextPage = makePage(['second-page'], null)
    vi.mocked(getPaginatedPage).mockResolvedValueOnce(nextPage)
    const { result, rerender } = renderHook(
      ({ initialData }: { initialData: TestPage }) =>
        usePaginatedList(initialData, '/api/v1/items', { filter: 'same' }),
      { initialProps: { initialData: initial } },
    )

    await act(async () => result.current.loadMore())
    const refreshed = makePage(['refreshed-first-version'], 'cursor')
    rerender({ initialData: refreshed })

    await waitFor(() => expect(result.current.pages).toEqual([refreshed, nextPage]))

    const refreshedPages = result.current.pages
    rerender({ initialData: refreshed })
    expect(result.current.pages).toBe(refreshedPages)
  })

  it('keeps rows displaced from a refreshed first page before older pages', async () => {
    const initial: EntityPage = {
      results: [
        { id: 'previous-first', label: 'Previous first' },
        { id: 'shared', label: 'Shared' },
      ],
      page_info: { has_next_page: true, end_cursor: 'first-cursor', start_cursor: null },
    }
    const olderPage: EntityPage = {
      results: [{ id: 'older', label: 'Older' }],
      page_info: { has_next_page: false, end_cursor: null, start_cursor: null },
    }
    vi.mocked(getPaginatedPage).mockResolvedValueOnce(olderPage)
    const { result } = renderHook(() => usePaginatedList(initial, '/api/v1/items', {}))
    await act(async () => result.current.loadMore())
    act(() => {
      result.current.replaceFirstPage?.({
        results: [
          { id: 'draft', label: 'Draft' },
          { id: 'shared', label: 'Shared refreshed' },
        ],
        page_info: { has_next_page: true, end_cursor: 'new-first-cursor', start_cursor: null },
      })
    })

    expect(result.current.pages).toEqual([
      {
        results: [
          { id: 'draft', label: 'Draft' },
          { id: 'shared', label: 'Shared refreshed' },
        ],
        page_info: { has_next_page: true, end_cursor: 'new-first-cursor', start_cursor: null },
      },
      { ...initial, results: [{ id: 'previous-first', label: 'Previous first' }] },
      olderPage,
    ])
  })

  it('derives query identity only from the endpoint and params', () => {
    const firstQueryKey = getPaginatedQueryKey('/api/v1/items', { filter: 'first' })

    expect(getPaginatedQueryKey('/api/v1/items', { filter: 'first' })).toBe(firstQueryKey)
    expect(getPaginatedQueryKey('/api/v1/items', { filter: 'second' })).not.toBe(firstQueryKey)
  })
})
