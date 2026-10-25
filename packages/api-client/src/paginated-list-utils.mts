import type { PaginatedData } from './paginated-query-key.mts'

type StableIdResult = {
  id: string | number
}

export function createQueryToken(): symbol {
  return Symbol('paginated query occurrence')
}

/**
 * Owns continuation request generations for a single paginated list instance.
 *
 * Every started request gets its own token. A generation reset releases the active request so the
 * new query can begin loading immediately; completions from any released request then fail
 * `isCurrent`, even if a newer request has since started on the same query.
 */
export class PaginatedRequestLifecycle {
  #queryToken = createQueryToken()
  #activeRequestToken: symbol | null = null

  get queryToken(): symbol {
    return this.#queryToken
  }

  reset(queryToken = createQueryToken()): symbol {
    this.#queryToken = queryToken
    this.#activeRequestToken = null
    return this.#queryToken
  }

  start(queryToken: symbol): symbol | null {
    if (queryToken !== this.#queryToken || this.#activeRequestToken !== null) return null
    this.#activeRequestToken = Symbol('paginated continuation request')
    return this.#activeRequestToken
  }

  isCurrent(requestToken: symbol): boolean {
    return this.#activeRequestToken === requestToken
  }

  finish(requestToken: symbol): void {
    if (this.#activeRequestToken === requestToken) this.#activeRequestToken = null
  }
}

function hasStableIdResults(
  page: PaginatedData,
): page is PaginatedData & { results: StableIdResult[] } {
  if (!('results' in page) || !Array.isArray(page.results)) return false
  return page.results.every(
    (result) =>
      typeof result === 'object' &&
      result !== null &&
      'id' in result &&
      (typeof result.id === 'string' || typeof result.id === 'number'),
  )
}

export function displacedFirstPage<T extends PaginatedData>(
  refreshedPage: T,
  previousFirstPage: T | undefined,
): T | undefined {
  if (
    !previousFirstPage ||
    !hasStableIdResults(refreshedPage) ||
    !hasStableIdResults(previousFirstPage)
  ) {
    return undefined
  }
  const refreshedIds = new Set(refreshedPage.results.map((result) => result.id))
  const results = previousFirstPage.results.filter((result) => !refreshedIds.has(result.id))
  return results.length === 0 ? undefined : ({ ...previousFirstPage, results } as T)
}

export function canPreservePaginationHistory(
  refreshedPage: PaginatedData,
  previousFirstPage: PaginatedData | undefined,
): boolean {
  if (
    !previousFirstPage ||
    !hasStableIdResults(refreshedPage) ||
    !hasStableIdResults(previousFirstPage) ||
    previousFirstPage.results.length === 0
  ) {
    return true
  }
  const previousIds = new Set(previousFirstPage.results.map((result) => result.id))
  return refreshedPage.results.some((result) => previousIds.has(result.id))
}

export function deduplicatePages<T extends PaginatedData>(pages: T[]): T[] {
  const seenIds = new Set<string | number>()
  let changed = false
  const deduplicatedPages = pages.map((page) => {
    if (!hasStableIdResults(page)) return page
    const results = page.results.filter((result) => {
      if (seenIds.has(result.id)) {
        changed = true
        return false
      }
      seenIds.add(result.id)
      return true
    })
    return results.length === page.results.length ? page : ({ ...page, results } as T)
  })
  return changed ? deduplicatedPages : pages
}

export function appendPaginatedPage<T extends PaginatedData>(pages: T[], page: T): T[] {
  return deduplicatePages([...pages, page])
}

/**
 * Re-read cursor pages from the first, following cursors until `loadedCount()` pages are read.
 * The count is re-evaluated after every fetch so pages loaded meanwhile are included. Following
 * stops once `isCurrent()` is false. A non-terminal page without a cursor is an error.
 */
export async function fetchLoadedCursorPages<T extends PaginatedData>(
  loadedCount: () => number,
  first: () => Promise<T>,
  next: (cursor: string) => Promise<T>,
  isCurrent: () => boolean,
): Promise<T[]> {
  const refreshed = [await first()]
  while (refreshed.length < loadedCount()) {
    const { has_next_page, end_cursor } = refreshed.at(-1)!.page_info
    if (!has_next_page) break
    if (!end_cursor) throw new Error('Paginated page has a next page but no end cursor')
    if (!isCurrent()) break
    // oxlint-disable-next-line no-await-in-loop -- the next cursor depends on this response
    refreshed.push(await next(end_cursor))
  }
  return refreshed
}
