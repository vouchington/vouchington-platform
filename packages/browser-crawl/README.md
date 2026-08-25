# @vouchington/browser-crawl

Generic rendered-page collection using caller-provided `playwright-core` connectivity. The package
does not launch a browser, select a provider, store results, enqueue work, or load ad-block lists.

## Install

```sh
pnpm add @vouchington/browser-crawl playwright-core
```

`playwright-core` is a peer dependency. Supply its connection method (for example,
`chromium.connectOverCDP`) rather than requiring this package to choose a browser runtime.

## Usage

```ts
import { chromium } from 'playwright-core'
import { crawlWithBrowser } from '@vouchington/browser-crawl'

const page = await crawlWithBrowser({
  url: 'https://example.test',
  endpoint: process.env.BROWSER_CDP_ENDPOINT!,
  connect: (endpoint) => chromium.connectOverCDP(endpoint),
  requestPolicy: async (url, kind) => securityPolicy.assertAllowed(url, kind),
})
```

The optional `requestPolicy` runs for every routable page request, regardless of URL scheme, and
every WebSocket connection. It is the
application's responsibility to perform SSRF protection, URL allow-listing, and any provider
specific filtering. A rejected policy aborts that request; a rejected navigation policy error is
returned to the caller unchanged.

The crawler blocks Service Workers, waits for `load`, reports the landed URL after redirects, and
best-effort captures HTML up to `maxHtmlBytes`. It always attempts to close the page, context, and
browser. Use `onCleanupError` if cleanup failures need application logging.
