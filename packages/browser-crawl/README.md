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

The optional `preparePage` hook receives the new page before `requestPolicy` is installed, for
example to enable an ad blocker's request routes. Playwright runs the most recently registered
route first, so `requestPolicy` still sees every request and the ad blocker sees only the requests
it allows. A rejected `preparePage` fails the crawl with `BrowserCrawlConnectError`. The package
still does not load filter lists itself:

```ts
const blocker = await loadBlocker() // for example, @ghostery/adblocker-playwright
await crawlWithBrowser({
  url,
  endpoint,
  connect: (endpoint) => chromium.connectOverCDP(endpoint),
  preparePage: (page) => blocker.enableBlockingInPage(page),
  requestPolicy: async (url, kind) => securityPolicy.assertAllowed(url, kind),
})
```

The crawler blocks Service Workers, waits for `load`, reports the landed URL after redirects, and
best-effort captures HTML up to `maxHtmlBytes`. It always attempts to close the page, context, and
browser. Use `onCleanupError` if cleanup failures need application logging.

Page measurement runs in one `page.evaluate` call with bounded work, so a hostile page cannot make
the crawler serialize or return an unbounded payload:

- `html` is omitted once the escaped serialization would exceed `maxHtmlBytes` (default 4 MiB). The
  DOM is measured before `outerHTML` is read.
- `title` is truncated to `maxTitleBytes` UTF-8 bytes (default 16 KiB).
- `contentLength` is the rendered body text length, capped at `minContentLength` (default 50),
  because it only decides `hasContent`.
- The DOM walk stops after `maxTraversalWork` nodes and characters (default 4 Mi). The page is then
  treated as having content, and `html` is omitted.
