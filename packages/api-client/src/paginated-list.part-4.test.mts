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

describe('usePaginatedList loadMore start signal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves false and does not fetch when there is no next page', async () => {
    const initial = makePage(['only'], null)
    const { result } = renderHook(() => usePaginatedList(initial, '/api/v1/items', {}))

    let started!: void | boolean
    await act(async () => {
      started = await result.current.loadMore()
    })

    expect(started).toBe(false)
    expect(getPaginatedPage).not.toHaveBeenCalled()
    expect(result.current.pages).toEqual([initial])
  })

  it('reads the latest cursor from a retained loadMore', async () => {
    const initial = makePage(['p1'], 'c1')
    getPaginatedPage
      .mockResolvedValueOnce(makePage(['p2'], 'c2'))
      .mockResolvedValueOnce(makePage(['p3'], null))
    const { result } = renderHook(() => usePaginatedList(initial, '/api/v1/items', {}))
    const retained = result.current.loadMore

    let results: boolean[] = []
    await act(async () => {
      results = [await retained(), await retained(), await retained()]
    })

    expect(results).toEqual([true, true, false])
    expect(getPaginatedPage.mock.calls.map(([, params]) => params.after)).toEqual(['c1', 'c2'])
    expect(result.current.pages.flatMap((page) => page.items)).toEqual(['p1', 'p2', 'p3'])
  })
})
