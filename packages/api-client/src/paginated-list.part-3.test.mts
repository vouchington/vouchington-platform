import { act, renderHook } from '@testing-library/react'
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

interface TestPage {
  items: string[]
  page_info: {
    has_next_page: boolean
    end_cursor: string | null
    start_cursor: string | null
  }
}

interface EntityPage {
  results: { id: string }[]
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

describe('usePaginatedList custom loaders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses a custom loader with the exact continuation cursor', async () => {
    const initial = makePage(['first'], 'opaque-cursor')
    const nextPage = makePage(['second'], null)
    const loadPage = vi.fn<(after: string) => Promise<TestPage>>().mockResolvedValue(nextPage)
    const { result } = renderHook(() =>
      usePaginatedList(initial, '/api/v1/custom-items', {}, { loadPage }),
    )

    await act(async () => result.current.loadMore())

    expect(loadPage).toHaveBeenCalledWith('opaque-cursor')
    expect(result.current.pages).toEqual([initial, nextPage])
    expect(getPaginatedPage).not.toHaveBeenCalled()
  })

  it('uses an endpoint-aware fetcher with merged continuation params', async () => {
    const initial = makePage(['first'], 'opaque-cursor')
    const nextPage = makePage(['second'], null)
    const fetchPage = vi
      .fn<(endpoint: string, params: { filter?: string; after?: string }) => Promise<TestPage>>()
      .mockResolvedValue(nextPage)
    const { result } = renderHook(() =>
      usePaginatedList(initial, '/api/v1/custom-items', { filter: 'same' }, { fetchPage }),
    )

    await act(async () => result.current.loadMore())

    expect(fetchPage).toHaveBeenCalledWith('/api/v1/custom-items', {
      filter: 'same',
      after: 'opaque-cursor',
    })
    expect(result.current.pages).toEqual([initial, nextPage])
    expect(getPaginatedPage).not.toHaveBeenCalled()
  })

  it('resets to a non-overlapping refreshed page and continues from its cursor', async () => {
    const initial: EntityPage = {
      results: [{ id: 'old-first' }],
      page_info: { has_next_page: true, end_cursor: 'old-cursor', start_cursor: null },
    }
    const refreshed: EntityPage = {
      results: [{ id: 'new-first' }],
      page_info: { has_next_page: true, end_cursor: 'new-cursor', start_cursor: null },
    }
    const gapPage: EntityPage = {
      results: [{ id: 'new-second' }],
      page_info: { has_next_page: false, end_cursor: null, start_cursor: null },
    }
    vi.mocked(getPaginatedPage).mockResolvedValueOnce(gapPage)
    const { result } = renderHook(() => usePaginatedList(initial, '/api/v1/items', {}))

    act(() => result.current.replaceFirstPage?.(refreshed))
    expect(result.current.pages).toEqual([refreshed])
    await act(async () => result.current.loadMore())

    expect(getPaginatedPage).toHaveBeenCalledWith('/api/v1/items', { after: 'new-cursor' })
    expect(result.current.pages).toEqual([refreshed, gapPage])
  })

  it('ignores a non-overlapping refresh captured by an older query render', () => {
    const first = {
      results: [{ id: 'first-query' }],
      page_info: { has_next_page: true, end_cursor: 'first-cursor', start_cursor: null },
    }
    const second = {
      results: [{ id: 'second-query' }],
      page_info: { has_next_page: true, end_cursor: 'second-cursor', start_cursor: null },
    }
    const { result, rerender } = renderHook(
      ({ page, filter }: { page: EntityPage; filter: string }) =>
        usePaginatedList(page, '/api/v1/items', { filter }),
      { initialProps: { page: first, filter: 'first' } },
    )
    const staleReplaceFirstPage = result.current.replaceFirstPage
    const staleRefresh = {
      results: [{ id: 'stale-refresh' }],
      page_info: { has_next_page: true, end_cursor: 'stale-cursor', start_cursor: null },
    }

    rerender({ page: second, filter: 'second' })
    act(() => staleReplaceFirstPage?.(staleRefresh))

    expect(result.current.pages).toEqual([second])
  })
})
