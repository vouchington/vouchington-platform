# @vouchington/http-transport

Redirect-safe HTTP transport primitives for server-side URL fetching. The caller supplies both an
Undici-compatible `fetch` and an address resolver. The resolver is invoked before every request
and redirect hop, and returns the dispatcher that has pinned the validated address to the socket.

```ts
import { createRedirectingFetch } from '@vouchington/http-transport'

const safeFetch = createRedirectingFetch({ fetch: undiciFetch, resolveDestination })
const response = await safeFetch('https://example.com/image.png')
```

`resolveDestination` is the SSRF security boundary. It must reject non-public addresses and return
a dispatcher that uses the resolved address, preventing DNS rebinding. This package deliberately
does not select hostname policy, DNS provider, user agent, timeout, or credential policy.

## Timed fetch and error mapping: `@vouchington/http-transport/fetch`

```ts
import { fetchWithTimeout, handleHttpErrors } from '@vouchington/http-transport/fetch'

const { response, responseSignal } = await fetchWithTimeout({
  url,
  headers,
  requestTimeoutMs: 10_000, // DNS, connect, request, headers
  responseTimeoutMs: 30_000, // body download, armed once headers arrive
  resolvedAddresses, // optional: pin the socket to validated addresses
  dispatchers,
})
handleHttpErrors({ response, url, onError }) // throws on 429 and 5xx
```

- `fetchWithTimeout` uses `redirect: 'manual'` and two independent timers. Pass `responseSignal`
  to whatever reads the body.
- `fetchWithTimeoutSimple(url, timeoutMs, dispatcher)` applies one timeout to a small fetch.
- `handleHttpErrors` throws `HttpRateLimitError` (with the parsed `Retry-After` delay in
  `retryAfterMs`) or `HttpServerError`. Pass `createRateLimitError` / `createServerError` to throw
  your own classes instead.
- `isTimeoutError` (`AbortError` or `TimeoutError`), `isNetworkError`, `isRetryableError(error,
  status?)` and `cancelResponseBody(response, onError)` are exported too.
- Retry and billing policy, such as which statuses may have been billed, stays with the caller.

## Dispatchers: `@vouchington/http-transport/dispatchers`

```ts
import { createHttpDispatchers } from '@vouchington/http-transport/dispatchers'

const dispatchers = createHttpDispatchers({
  onError: reportError,
  interceptors: () => (egressGuardEnabled ? [egressGuard] : []),
})
onShutdown(dispatchers.closeHttpDispatchers) // the package registers nothing itself
```

`createHttpDispatchers` returns `getExternalRequestDispatcher`,
`getLongRunningExternalRequestDispatcher`, `getPinnedRequestDispatcher(addresses)`, the stable SDK
fetches `getExternalFetch` and `getLongRunningExternalFetch`, an idempotent `closeHttpDispatchers`,
and `Symbol.asyncDispose`. Nothing happens at import time.

Defaults: 60 s headers (300 s long-running), 300 s body gap, 4 s keep-alive up to 600 s, 10 s
connect, 5 connections, and a pinned cache of 100. Override any of them with the `*TimeoutMs`,
`connections` and `pinnedCacheSize` options. `interceptors` is called on every lookup; a non-empty
result is composed onto the shared dispatcher (cached per base dispatcher) so an application can
enable an egress guardrail whenever it chooses. Pinned dispatchers are never composed.
