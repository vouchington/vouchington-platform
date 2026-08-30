# `@vouchington/embeds`

Policy-injected HTML unfurl and oEmbed resolution for Node.js applications.

The package fetches HTML through `@vouchington/http-transport`, extracts document metadata through
`@vouchington/crawler-html`, optionally resolves JSON oEmbed, and returns only normalized metadata.
Raw oEmbed HTML is never returned. Host allowlists, robots decisions, credentials, and persistence
remain application policy.

## Usage

```ts
import { createEmbedResolver } from '@vouchington/embeds'
import { youtubeProvider, vimeoProvider } from '@vouchington/embeds/providers'

const resolver = createEmbedResolver({
  fetch,
  userAgent: 'example-crawler/1.0 (+https://example.com/crawler)',
  providers: [youtubeProvider, vimeoProvider],
  authorizeUrl: async (url, { purpose, sourceUrl }) => {
    // Apply app-owned host, robots, and article/player policy here.
    return policy.allows(url, { purpose, sourceUrl })
  },
  resolveDestination: async (url, signal) => {
    // Validate DNS/IPs and return an Undici dispatcher pinned to that decision.
    return await ssrfResolver.resolve(url, signal)
  },
})

const metadata = await resolver.resolve('https://www.youtube.com/watch?v=example')
```

`authorizeUrl` runs before destination resolution for the document, every redirect, the oEmbed
endpoint and every oEmbed redirect. Player URLs are also authorized before they can appear in the
result. A denied document fails resolution; a denied player produces article metadata instead.
oEmbed is optional, so endpoint, payload, and policy failures call `onOEmbedError` and fall back to
document metadata.

Author, provider, and thumbnail URLs are opaque metadata and are not fetched or authorized by this
package. A consumer must apply its own policy before fetching, proxying, or navigating to them.

If an application already extracted a document with `@vouchington/crawler-html`, use
`resolveExtracted` to avoid fetching it again:

```ts
const metadata = await resolver.resolveExtracted({ documentUrl, content: extractedContent })
```

## Provider presets

No providers are enabled by default. The `@vouchington/embeds/providers` entrypoint exports opt-in
presets for YouTube, Vimeo, and PeerTube plus `matchEmbedProvider`. Applications can implement the
same `EmbedProvider` interface for other services.

The presets identify resources and supply canonical player/oEmbed URLs. They do not bypass
`authorizeUrl`; the application remains responsible for deciding which document, endpoint, and
player origins are allowed.

## Limits

Document bodies default to 10 MiB, oEmbed bodies to 256 KiB, redirects to five, and the overall
operation timeout to ten seconds. All are configurable. Responses are bounded while streaming and
cancelled when a limit is exceeded.
