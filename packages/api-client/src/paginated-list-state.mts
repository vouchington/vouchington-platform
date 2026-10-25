import { deduplicatePages } from './paginated-list-utils.mts'
import type { PaginatedData } from './paginated-query-key.mts'

export type ListState<T> = {
  key: string
  sourceInitialData: T
  queryToken: symbol
  pages: T[]
  fetchError: Error | null
  loadingMore: boolean
}

export function freshState<T extends PaginatedData>(
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
