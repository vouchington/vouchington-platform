import { useLayoutEffect, useMemo, useState } from 'react'
import {
  appendPaginatedPage,
  canPreservePaginationHistory,
  createQueryToken,
  deduplicatePages,
  displacedFirstPage,
  PaginatedRequestLifecycle,
} from './paginated-list-utils.mts'
import {
  getPaginatedQueryKey,
  pageInfoKey,
  type PaginatedData,
  type PaginatedListParams,
} from './paginated-query-key.mts'

export { getPaginatedQueryKey }
export type { PaginatedData, PaginatedListParams }

export type PaginatedPageFetcher<T> = (endpoint: string, params: PaginatedListParams) => Promise<T>

export type UsePaginatedListResult<T> = {
  pages: T[]
  hasNextPage: boolean
  endCursor: string | null
  loadMore: () => Promise<boolean>
  loadingMore: boolean
  fetchError: Error | null
  clearError: () => void
  replaceFirstPage: (page: T) => void
  resetToFirstPage: (page: T) => void
  resetKey: symbol
}

/** The application supplies how the next page is fetched: `fetchPage` wins over `loadPage`. */
export type UsePaginatedListOptions<T> =
  | { fetchPage: PaginatedPageFetcher<T>; loadPage?: (after: string) => Promise<T> }
  | { loadPage: (after: string) => Promise<T>; fetchPage?: PaginatedPageFetcher<T> }

type ListState<T> = {
  key: string
  sourceInitialData: T
  queryToken: symbol
  pages: T[]
  fetchError: Error | null
  loadingMore: boolean
}

function freshState<T extends PaginatedData>(
  key: string,
  initialData: T,
  queryToken: symbol,
  page: T = initialData,
): ListState<T> {
  return {
    key,
    sourceInitialData: initialData,
    queryToken,
    pages: deduplicatePages([page]),
    fetchError: null,
    loadingMore: false,
  }
}

/**
 * Accumulates cursor pages for infinite-scroll lists. The server renders page 1; later pages load
 * client-side through the injected fetcher.
 *
 * Resets accumulated pages when the query changes (endpoint/params/page_info fingerprint), so
 * stale pages never mix with a new query. When the fingerprint is unchanged but `initialData` is a
 * new object (a server re-render after navigation or a mutation), only `pages[0]` is refreshed.
 */
export function usePaginatedList<T extends PaginatedData>(
  initialData: T,
  endpoint: string,
  params: PaginatedListParams,
  options: UsePaginatedListOptions<T>,
): UsePaginatedListResult<T> {
  const currentKey = pageInfoKey(initialData, endpoint, params)
  const requestLifecycle = useMemo(() => new PaginatedRequestLifecycle(), [])
  const [listState, setListState] = useState<ListState<T>>(() =>
    freshState(currentKey, initialData, requestLifecycle.queryToken),
  )
  let currentListState = listState
  if (listState.key !== currentKey) {
    currentListState = freshState(currentKey, initialData, createQueryToken())
    setListState(currentListState)
  } else if (listState.sourceInitialData !== initialData) {
    currentListState = {
      ...listState,
      sourceInitialData: initialData,
      pages: deduplicatePages([initialData, ...listState.pages.slice(1)]),
    }
    setListState(currentListState)
  }
  useLayoutEffect(() => {
    if (requestLifecycle.queryToken !== listState.queryToken) {
      requestLifecycle.reset(listState.queryToken)
    }
  }, [listState.queryToken, requestLifecycle])
  const { pages, fetchError, loadingMore, queryToken: currentQueryToken } = currentListState
  const { has_next_page, end_cursor } = pages.at(-1)!.page_info

  function updateCurrent(token: symbol, update: (prev: ListState<T>) => Partial<ListState<T>>) {
    setListState((prev) => (prev.queryToken === token ? { ...prev, ...update(prev) } : prev))
  }

  async function loadMore(): Promise<boolean> {
    if (!has_next_page || !end_cursor || !endpoint) return false
    const requestToken = requestLifecycle.start(currentQueryToken)
    if (!requestToken) return false
    updateCurrent(requestToken, () => ({ loadingMore: true }))
    try {
      const pending = options.fetchPage
        ? options.fetchPage(endpoint, { ...params, after: end_cursor })
        : options.loadPage!(end_cursor)
      const nextPage = await pending
      if (requestLifecycle.isCurrent(requestToken)) {
        updateCurrent(requestToken, (prev) => ({
          pages: appendPaginatedPage(prev.pages, nextPage),
          fetchError: null,
        }))
      }
    } catch (err) {
      if (requestLifecycle.isCurrent(requestToken)) {
        updateCurrent(requestToken, () => ({
          fetchError: err instanceof Error ? err : new Error('Failed to load more'),
        }))
      }
    } finally {
      if (requestLifecycle.isCurrent(requestToken)) {
        requestLifecycle.finish(requestToken)
        updateCurrent(requestToken, () => ({ loadingMore: false }))
      }
    }
    return true
  }

  function replaceFirstPage(page: T) {
    if (!canPreservePaginationHistory(page, pages[0])) {
      resetToFirstPage(page)
      return
    }
    updateCurrent(currentQueryToken, (prev) => {
      const [previousFirstPage, ...olderPages] = prev.pages
      const displacedPage = displacedFirstPage(page, previousFirstPage)
      return {
        pages: deduplicatePages([page, ...(displacedPage ? [displacedPage] : []), ...olderPages]),
      }
    })
  }

  function resetToFirstPage(page: T) {
    const replacement = freshState(currentKey, initialData, createQueryToken(), page)
    updateCurrent(currentQueryToken, () => replacement)
  }

  return {
    pages,
    hasNextPage: has_next_page,
    endCursor: end_cursor,
    loadMore,
    loadingMore,
    fetchError,
    clearError: () => updateCurrent(currentQueryToken, () => ({ fetchError: null })),
    replaceFirstPage,
    resetToFirstPage,
    resetKey: currentQueryToken,
  }
}
