# @vouchington/rss-crawler

Fetches one feed through a caller-provided transport and parses it with `@vouchington/rss-parser`. DNS, SSRF, retries, proxies, caches, and observability stay at the adapter boundary.

```ts
import { crawlFeed } from '@vouchington/rss-crawler'
```
