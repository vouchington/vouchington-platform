// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { usePaginatedList } from './paginated-list.mts'
import {
  canPreservePaginationHistory,
  displacedFirstPage,
  PaginatedRequestLifecycle,
} from './paginated-list-utils.mts'
import { getPaginatedQueryKey } from './paginated-query-key.mts'

type Page = {
  results: { id: string }[]
  page_info: { has_next_page: boolean; end_cursor: string | null }
}

const page = (ids: string[], end: string | null): Page => ({
  results: ids.map((id) => ({ id })),
  page_info: { has_next_page: end !== null, end_cursor: end },
})

describe('paginated query keys', () => {
  it('sorts params and omits undefined values', () => {
    expect(getPaginatedQueryKey('/x', { b: 1, a: undefined })).toBe('/x|b=1')
    expect(getPaginatedQueryKey('/x', { q: '' })).toBe('/x|q=')
  })
})

describe('page history helpers', () => {
  it('handles missing and unstable pages', () => {
    const stable = page(['a'], null)
    const unstable = { page_info: stable.page_info } as unknown as Page
    expect(displacedFirstPage(stable, undefined)).toBeUndefined()
    expect(displacedFirstPage(unstable, stable)).toBeUndefined()
    expect(displacedFirstPage(stable, unstable)).toBeUndefined()
    expect(canPreservePaginationHistory(stable, undefined)).toBe(true)
    expect(canPreservePaginationHistory(unstable, stable)).toBe(true)
    expect(canPreservePaginationHistory(stable, unstable)).toBe(true)
    expect(canPreservePaginationHistory(stable, page([], null))).toBe(true)
    expect(canPreservePaginationHistory(page(['z'], null), page(['a'], null))).toBe(false)
  })
})

const initial = page(['a'], 'c')
const lastPage = page(['a'], null)

describe('usePaginatedList failures', () => {
  it('surfaces fetch errors, normalizes non-errors, and clears them', async () => {
    const fetchPage = vi
      .fn<() => Promise<Page>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce('weird')
    const { result } = renderHook(() => usePaginatedList(initial, '/x', {}, { fetchPage }))

    await act(async () => void (await result.current.loadMore()))
    expect(result.current.fetchError?.message).toBe('boom')
    act(() => result.current.clearError())
    expect(result.current.fetchError).toBeNull()

    await act(async () => void (await result.current.loadMore()))
    expect(result.current.fetchError?.message).toBe('Failed to load more')
    expect(result.current.loadingMore).toBe(false)
  })

  it('ignores failures from a request superseded by a reset', async () => {
    let rejectFirst!: (reason: Error) => void
    const fetchPage = vi.fn(() => new Promise<Page>((_, reject) => (rejectFirst = reject)))
    const { result } = renderHook(() => usePaginatedList(initial, '/x', {}, { fetchPage }))
    let pending!: Promise<boolean>
    act(() => {
      pending = result.current.loadMore()
    })
    act(() => result.current.resetToFirstPage(page(['b'], null)))
    await act(async () => {
      rejectFirst(new Error('late'))
      await pending
    })
    expect(result.current.fetchError).toBeNull()
    expect(result.current.pages).toEqual([page(['b'], null)])
  })

  it('ignores results from a request superseded by a reset', async () => {
    let resolveFirst!: (value: Page) => void
    const fetchPage = vi.fn(() => new Promise<Page>((resolve) => (resolveFirst = resolve)))
    const { result } = renderHook(() => usePaginatedList(initial, '/x', {}, { fetchPage }))
    let pending!: Promise<boolean>
    act(() => {
      pending = result.current.loadMore()
    })
    act(() => result.current.resetToFirstPage(page(['b'], null)))
    await act(async () => {
      resolveFirst(page(['late'], null))
      await pending
    })
    expect(result.current.pages).toEqual([page(['b'], null)])
  })

  it('does nothing without a next page or endpoint', async () => {
    const fetchPage = vi.fn<() => Promise<Page>>()
    const last = renderHook(() => usePaginatedList(lastPage, '/x', {}, { fetchPage }))
    expect(await last.result.current.loadMore()).toBe(false)
    const noEndpoint = renderHook(() => usePaginatedList(initial, '', {}, { fetchPage }))
    expect(await noEndpoint.result.current.loadMore()).toBe(false)
    expect(fetchPage).not.toHaveBeenCalled()
  })
})

describe('request lifecycle and page merging', () => {
  it('ignores finishing a request that is not active', () => {
    const lifecycle = new PaginatedRequestLifecycle()
    const token = lifecycle.start(lifecycle.queryToken)!
    lifecycle.finish(Symbol('other'))
    expect(lifecycle.isCurrent(token)).toBe(true)
    lifecycle.finish(token)
    expect(lifecycle.isCurrent(token)).toBe(false)
  })

  it('treats results without stable ids as unstable', () => {
    for (const results of [[null], [{}], [{ id: true }], 'no']) {
      const unstable = { results, page_info: lastPage.page_info } as unknown as Page
      expect(displacedFirstPage(lastPage, unstable)).toBeUndefined()
    }
  })

  it('drops a displaced page when every previous result was refreshed', () => {
    expect(displacedFirstPage(page(['a', 'b'], null), page(['a'], null))).toBeUndefined()
  })

  it('replaces the first page outright when nothing was displaced', () => {
    const first = page(['a'], 'c')
    const { result } = renderHook(() =>
      usePaginatedList(first, '/x', {}, { loadPage: async () => page(['z'], null) }),
    )
    act(() => result.current.replaceFirstPage(page(['a', 'b'], 'c')))
    expect(result.current.pages).toEqual([page(['a', 'b'], 'c')])
  })

  it('keeps displaced older results when the first page is replaced', () => {
    const first = page(['a', 'b'], 'c')
    const { result } = renderHook(() =>
      usePaginatedList(first, '/x', {}, { loadPage: async () => page(['z'], null) }),
    )
    act(() => result.current.replaceFirstPage(page(['b', 'new'], 'c')))
    expect(result.current.pages).toEqual([page(['b', 'new'], 'c'), page(['a'], 'c')])
  })
})
