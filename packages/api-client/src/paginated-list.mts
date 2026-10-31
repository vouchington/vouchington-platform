import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  appendPaginatedPage,
  canPreservePaginationHistory,
  createQueryToken,
  deduplicatePages,
  displacedFirstPage,
  fetchLoadedCursorPages,
  PaginatedRequestLifecycle,
} from './paginated-list-utils.mts'
import { freshState, type ListState } from './paginated-list-state.mts'
import {
  getPaginatedQueryKey,
  pageInfoKey,
  type PaginatedData,
  type PaginatedListParams,
} from './paginated-query-key.mts'

export { appendPaginatedPage, PaginatedRequestLifecycle, getPaginatedQueryKey }
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
  refreshLoadedPages: (fetchFirstPage: () => Promise<T>) => Promise<void>
  resetToFirstPage: (page: T) => void
  resetKey: symbol
}

/** The application supplies how the next page is fetched: `fetchPage` wins over `loadPage`. */
export type UsePaginatedListOptions<T> =
  | { fetchPage: PaginatedPageFetcher<T>; loadPage?: (after: string) => Promise<T> }
  | { loadPage: (after: string) => Promise<T>; fetchPage?: PaginatedPageFetcher<T> }

/**
 * Accumulates cursor pages for infinite-scroll lists. The server renders page 1; later pages load
 * client-side through the injected fetcher.
 *
 * Resets accumulated pages when the query changes (endpoint/params/page_info fingerprint), so
 * stale pages never mix with a new query. When the fingerprint is unchanged but `initialData` is a
 * new object (a server re-render after navigation or a mutation), only `pages[0]` is refreshed.
 * `initialData` must be referentially stable between renders of the same data (do not rebuild it
 * during render), because a new identity is treated as a refreshed first page.
 */
export function usePaginatedList<T extends PaginatedData>(
  initialData: T,
  endpoint: string,
  params: PaginatedListParams,
  options: UsePaginatedListOptions<T>,
): UsePaginatedListResult<T> {
  const currentKey = pageInfoKey(initialData, endpoint, params)
  const requestLifecycle = useMemo(() => new PaginatedRequestLifecycle(), [])
  const refreshGeneration = useRef(0)
  const loadedCount = useRef(1)
  const latestPages = useRef<T[]>([])
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
  loadedCount.current = pages.length
  latestPages.current = pages
  const { has_next_page, end_cursor } = pages.at(-1)!.page_info

  function updateCurrent(token: symbol, update: (prev: ListState<T>) => Partial<ListState<T>>) {
    setListState((prev) => (prev.queryToken === token ? { ...prev, ...update(prev) } : prev))
  }

  function fetchAfter(cursor: string): Promise<T> {
    return options.fetchPage
      ? options.fetchPage(endpoint, { ...params, after: cursor })
      : options.loadPage!(cursor)
  }

  async function loadMore(): Promise<boolean> {
    // Read the latest cursor: a retained `loadMore` must not reuse the render that created it.
    const latestPageInfo = latestPages.current.at(-1)!.page_info
    const cursor = latestPageInfo.end_cursor
    if (!latestPageInfo.has_next_page || !cursor || !endpoint) return false
    const requestToken = requestLifecycle.start(currentQueryToken)
    if (!requestToken) return false
    updateCurrent(currentQueryToken, () => ({ loadingMore: true }))
    try {
      const nextPage = await fetchAfter(cursor)
      if (requestLifecycle.isCurrent(requestToken)) {
        loadedCount.current += 1 // synchronous: a refresh may commit before React renders this
        latestPages.current = appendPaginatedPage(latestPages.current, nextPage)
        updateCurrent(currentQueryToken, (prev) => ({
          pages: appendPaginatedPage(prev.pages, nextPage),
          fetchError: null,
        }))
      }
    } catch (err) {
      if (requestLifecycle.isCurrent(requestToken)) {
        updateCurrent(currentQueryToken, () => ({
          fetchError: err instanceof Error ? err : new Error('Failed to load more'),
        }))
      }
    } finally {
      if (requestLifecycle.isCurrent(requestToken)) {
        requestLifecycle.finish(requestToken)
        updateCurrent(currentQueryToken, () => ({ loadingMore: false }))
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

  /**
   * Re-reads every loaded page from the first, including pages a concurrent `loadMore` appends
   * before the commit, then swaps them in at once. A `loadMore` still in flight at the commit
   * started from the old boundary, so its result is discarded. A refresh superseded by a reset,
   * a query change, or a newer refresh is dropped, and a failure keeps the current pages and
   * surfaces through `fetchError`. A callback retained from an earlier query occurrence is a no-op.
   */
  async function refreshLoadedPages(fetchFirstPage: () => Promise<T>): Promise<void> {
    const isLive = () => currentQueryToken === requestLifecycle.queryToken
    if (!isLive()) return
    const generation = ++refreshGeneration.current
    const isCurrent = () => refreshGeneration.current === generation && isLive()
    try {
      const refreshed = await fetchLoadedCursorPages(
        () => loadedCount.current,
        fetchFirstPage,
        fetchAfter,
        isCurrent,
      )
      if (!isCurrent()) return
      requestLifecycle.reset(currentQueryToken)
      updateCurrent(currentQueryToken, () => ({
        pages: deduplicatePages(refreshed),
        fetchError: null,
        loadingMore: false,
      }))
    } catch (err) {
      if (!isCurrent()) return
      updateCurrent(currentQueryToken, () => ({
        fetchError: err instanceof Error ? err : new Error('Failed to refresh'),
      }))
    }
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
    refreshLoadedPages,
    resetToFirstPage,
    resetKey: currentQueryToken,
  }
}
