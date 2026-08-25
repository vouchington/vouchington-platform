# @vouchington/rss-crawler

Fetches one feed through a caller-provided transport and parses it with `@vouchington/rss-parser`. DNS, SSRF, retries, proxies, caches, and observability stay at the adapter boundary.

```ts
import { crawlFeed } from '@vouchington/rss-crawler'
```

## Adapter hooks

`responseBodyReader` may replace the default bounded stream reader. It receives a readonly context
with the `Response`, requested URL, effective `maxResponseSizeBytes`, and crawl timeout's
`AbortSignal`; return a `Uint8Array` (including a Node `Buffer`) and honor both the byte limit and
signal.

`responseErrorHandler` receives synchronous discriminated `http`, `content-type`, and `redirect`
contexts before the built-in error is thrown. Return an adapter-specific `Error` to preserve that
exact error identity, or `undefined` to use the package's current default error. Async handlers are
not accepted.

`redirectResolver` receives a readonly context containing the raw `Location` value and requested
URL. Its default resolves the location with `new URL(location, baseUrl)`, while an adapter can keep
relative locations raw or apply its own redirect policy.

The crawler owns response-body cancellation in a `finally` block, including when a hook throws.
Custom body readers own cancellation and lock release for every `ReadableStreamDefaultReader` they
acquire. Neither reader nor response cleanup errors replace the crawl outcome.

## Provenance

Generalized from Filaments revision `2bd1d813f858da613fa89eec76037379503d9fd1`, primarily
`backend/services/rss-feeds/fetch.mts` and `backend/services/crawler-rss/index.mts`.
