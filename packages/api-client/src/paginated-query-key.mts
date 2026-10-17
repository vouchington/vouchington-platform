export type PaginatedListParams = Record<string, string | number | boolean | undefined>

function serializeParams(params: PaginatedListParams): string {
  return new URLSearchParams(
    Object.keys(params)
      .toSorted()
      .filter((key) => params[key] !== undefined)
      .map((key) => [key, String(params[key])] as [string, string]),
  ).toString()
}

/** Stable `endpoint|sortedParams` key, suitable for query caches. Undefined params are omitted. */
export function getPaginatedQueryKey(endpoint: string, params: PaginatedListParams): string {
  return `${endpoint}|${serializeParams(params)}`
}

/** Cursor-pagination metadata the list helpers read from every page. */
export type PaginatedData = {
  page_info: { has_next_page: boolean; end_cursor: string | null }
}

/** Fingerprint of a page's query and cursor state, used to detect query changes. */
export function pageInfoKey(
  data: PaginatedData,
  endpoint: string,
  params: PaginatedListParams,
): string {
  const { end_cursor, has_next_page } = data.page_info
  return `${endpoint}|${end_cursor ?? ''}|${has_next_page}|${serializeParams(params)}`
}
