# @vouchington/rss-crawler

Fetches one feed through a caller-provided transport and parses it with `@vouchington/rss-parser`. DNS, SSRF, retries, proxies, caches, and observability stay at the adapter boundary.

```ts
import { crawlFeed } from '@vouchington/rss-crawler'
```

## Provenance

Generalized from Filaments revision `2bd1d813f858da613fa89eec76037379503d9fd1`, primarily
`backend/services/rss-feeds/fetch.mts` and `backend/services/crawler-rss/index.mts`.
