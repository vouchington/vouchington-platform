# @vouchington/edge

Builders for Cloudflare Workers. The package exports functions, not a worker: the route table,
CSP origins, analytics and Sentry DSNs, origin hosts, and cache rules are injected by the
application.

```ts
import {
  addSecurityHeaders,
  buildCsp,
  buildOriginRequest,
  createBasicAuthGate,
  createSentryTunnel,
  fetchOriginResponse,
  rewritePlaceholderNonce,
} from '@vouchington/edge'
```

## Builders

- Security headers: `addSecurityHeaders`, `buildSecurityHeaders`, `buildHsts`. The edge overwrites
  origin values and preserves repeated `set-cookie` headers.
- CSP: `buildCsp` starts from strict defaults and takes injected `sources`, `directives`, a nonce, and
  an asset origin. `serializeCsp` rejects sources that could inject another directive.
  `normalizeAssetOrigin` and `parseOriginAllowlist` validate configuration values.
- Nonce rewriting: `rewritePlaceholderNonce` streams HTML and swaps a cache placeholder nonce for a
  per-request nonce without buffering the document. It handles chunk boundaries and can drop
  injected `<meta name>` tags.
- Basic auth: `createBasicAuthGate` with timing-safe credential matching, rotation lists, a
  fail-closed malformed-list rule, and an injected exemption matcher
  (`createBasicAuthExemptMatcher`).
- Proxying: `buildOriginRequest` retargets a request, strips client-supplied forwarding headers, owns
  the request id and shared secret, and keeps redirects manual. `fetchOriginResponse` retries GET and
  HEAD once after a dropped socket and maps failures to a no-store 502.
- Cache helpers: `bypassPolicy`, `cachedPolicy`, `buildCacheControlHeader`, `isCacheableResponse`,
  `parseSafeCacheVary`, `mergeClientVary`, `normalizeCacheUrl`, `finalizeCachedOriginResponse`,
  `stripDispatchOnlyHeaders`, and `purgeCacheTags`. The route-to-policy decision stays in the app.
- Environment checks: `createEnvWarner` (warn once per isolate), `warnIfSecretMisconfigured`,
  `warnIfProductionValueInvalid`, `warnIfAssetOriginInvalid`, `warnIfDsnInvalid`, `isProductionMode`.
- Client info and cookies: `applyClientInfoHeaders` with injected header names, `replaceCookies`,
  `stripCookies`. Cookie parsing comes from `@vouchington/utils/cookies`.
- Sentry tunnel: `createSentryTunnel` forwards envelopes only to injected trusted DSNs, caps the body,
  and logs bounded diagnostics via `@vouchington/utils/sentry-envelope`.

`@cloudflare/workers-types` is an optional peer dependency used for the `cache.purge` context type.
