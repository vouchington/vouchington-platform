# @vouchington/api-client

Generic JSON API client building blocks for browser and server code. Everything product-specific
is injected: base URL, auth headers, error-code catalog, storage namespace, and error reporting.
The root export has no React dependency; React is an optional peer dependency of the
`@vouchington/api-client/paginated-list` subpath only.

```ts
import {
  ApiError,
  ClientRequest,
  ServerRequest,
  createErrorCodeChecker,
} from '@vouchington/api-client'

const api = new ClientRequest({
  baseUrl: '/api',
  headers: () => ({ 'X-Csrf': readCsrfToken() }),
  retryAfterConflictCodes: ['ADMISSION_IN_PROGRESS'], // 409 codes that carry `retry_after`
  onError: reportError,
})
const posts = await api.get<Post[]>('/posts', { searchParams: { limit: 20 } })

const server = new ServerRequest({
  baseUrl: () => process.env.API_BASE_URL ?? 'http://localhost:2900',
  resolveHeaders: async () => ({ Cookie: await readForwardedCookies() }),
  fetchInit: { cache: 'no-store' },
})
```

- `ClientRequest` and `ServerRequest` expose `request`, `get`, `post`, `put`, `patch`, and `delete`.
  Failures become `ApiError` (`status`, `code`, `requestId`, `data`, `digest`); aborts propagate
  unchanged; 429 (and the injected 409 codes) add `retry_after` from the `Retry-After` header.
  `ServerRequest` adds an `Origin` header to non-GET requests that carry a `Cookie` header.
- Error helpers: `getApiErrorMessage`, `hasErrorCode`, `createErrorCodeChecker(catalog)`,
  `parseErrorDigest(digest, copyByStatus, fallback)`, `isExpectedApiError`, and the bounded
  `parseErrorResponseBody`.
- `AdmissionIdempotency` pairs each distinct intent with one idempotency key so retries, including
  across reloads, reuse it. Durable persistence needs an `actorId`, `localStorage`, and Web Locks;
  anonymous intents stay in memory. Options inject `namespace` (storage-key and lock-name prefix),
  `transientFields` (excluded from intent identity), `storage`, `lockManager`, `now`, `fingerprint`,
  and `onError`. `pause`, `resume`, `drain`, and `setActor` support logout flows.
- `@vouchington/api-client/paginated-list` exports `usePaginatedList(initial, endpoint, params,
  { fetchPage | loadPage })` for cursor-page accumulation with stale-request protection, plus
  `getPaginatedQueryKey`. The application supplies the page fetcher, and `initialData` must keep a stable identity across renders.
  The hook also returns `replaceFirstPage`, `resetToFirstPage`, and `refreshLoadedPages(fetchFirstPage)`,
  which re-reads every loaded page from the first (following cursors) and swaps the result in at
  once. Pages appended by a concurrent `loadMore` are kept without duplicates, a refresh superseded
  by a reset or a newer refresh is discarded, and a failure keeps the current pages and surfaces
  through `fetchError`. `PaginatedRequestLifecycle` and `appendPaginatedPage` are exported from the
  same subpath for driving pagination lifecycles outside the hook.
