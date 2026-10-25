# @vouchington/utils

Dependency-free utilities for Node.js 24 applications. This package deliberately has no root
export: import the capability you use from an explicit subpath.

```ts
import { createTokenSecrets } from '@vouchington/utils/token-secrets'
import { createMoneyCatalog } from '@vouchington/utils/money'
import { parseCookies, serializeCookie } from '@vouchington/utils/cookies'
import { buildSignatureHeaders, verifySignature } from '@vouchington/utils/http-signatures'
import { bestAcceptLanguageMatch } from '@vouchington/utils/language-tags'
import { createMessageTranslator } from '@vouchington/utils/message-catalog'
import { createReportInputParser } from '@vouchington/utils/moderation'
import { cacheTag, decodeCacheTagPathSegment } from '@vouchington/utils/cache-tags'
import { getSentryEnvelopeDiagnostics } from '@vouchington/utils/sentry-envelope'
import { createScopeCatalog } from '@vouchington/utils/scopes'
```

## Subpaths

- `ai-moderation`: moderation input building, flagged-category and prompt-injection checks that
  return violations; the caller makes the provider call.
- `bedrock-embeddings` and `bedrock-embedding-batches`: Nova `InvokeModel` input builders, response
  parsing and dense-vector validation, and batch JSONL record and result codecs with opaque record
  ids; the caller owns the AWS client.
- `cache-tags`: canonical printable-ASCII wire encoding, one-segment URL decoding, validation,
  and escape-boundary truncation. Applications own family names, route recognition, and purge policy.
  Single-tag validation rejects spaces and comma separators; raw commas are percent-encoded.
- `schema-growth`: `buildUnboundedUnpartitionedTables()` and `classifyTableGrowth()` map tables to
  caller-supplied growth reasons. Applications own every table name and reason.
- `web-push`: push-subscription JSON validation with an injected endpoint policy, base64url and
  VAPID public-key decoding, and bounded payload build/parse helpers. No sending or storage.
- `web-push-vapid` (Node): VAPID key generation/matching and ES256 JWT/`Authorization` builders.
  Applications own key storage, subject, and delivery.
- `web-push-binding` (browser): service-worker binding-state guards, one MessageChannel
  request/acknowledge round trip with an injected message type and acceptance check, and a named
  Web Lock wrapper. Request actions, expected state transitions, and the bind/clear/reconcile
  sequence stay in the application.
- `service-worker-activation`: `waitForActiveServiceWorker(registration, options)` resolves when
  the registration has an active worker. An installing or waiting worker is preferred over
  `serviceWorker.ready`. `timeoutMs` bounds the wait; omit it to wait without a deadline. The
  caller supplies the timeout and may inject `serviceWorker` (default `navigator.serviceWorker`).
- `json-ld`: schema.org JSON-LD builders (organization, website, navigation, collection, thing,
  comparison, item list, breadcrumb, profile) and script-safe serialization. Callers inject the
  absolute-URL resolver and site name; product schemas such as posts stay in the application.
- `seo-metadata`: framework-agnostic page, root, and noindex metadata objects (structurally
  compatible with Next.js `Metadata`), excerpts, and markdown-alternate paths. Callers inject site
  config, image URLs, locale mapping, and alternate prefixes.
- `speculation-rules`: prefetch speculation-rules builder and preconnect-origin parsing with
  caller-supplied exclusions.
- `sentry-envelope`: bounded UTF-8 envelope record scanning and safe item-type diagnostics.
  Callers choose the byte and type-list limits; DSN, tunnel, request, and logging policy stay local.
- `scopes`: caller-owned scope catalog validation, prerequisite expansion, audience and surface
  filtering, and explicit coverage graph calculation. No default catalog or legacy grants are built in.
- `token-secrets`: Node-only (`node:crypto`) purpose-bound HMAC and AES-256-GCM encryption.
  `createTokenSecrets({ hashSecret, encryptionKeys })` throws for invalid keys or ciphertext.
- `deploy-environment`: `getDeployEnvironment(source)` classifies explicit environment inputs without
  throwing.
- `url-signing`: Node-only HMAC SHA-256 path signing (`signPathWithKey`, `signPath`,
  `verifyPathSignature` with rotation, `signExpiringPath`/`verifyExpiringPath` with an injectable
  clock), `parseSigningKeys`, `buildSignedProxyUrl` (caller-owned origin, route prefix, query, and
  skip predicate), `createProtectedHostPolicy`, `matchRouteSegment`, and `authorizeDependencyStates`.
  Prefixes, hosts, and keys are injected; verification fails closed with no keys unless
  `allowUnsignedWhenNoKeys` is set.
- `request-client-info`: `createClientInfoParser(config)` validates caller-selected headers,
  families, platforms, compatibility, and versions.
- `money`: `createMoneyCatalog(currencies, scale)` supplies exact integer parsing and validation for
  the caller's catalog. `allocateProportionalAmount(amount, numerator, denominator, rounding)`
  allocates an inclusive fraction with `down` or `up` integer rounding chosen explicitly by the
  caller; it uses exact integer arithmetic rather than floating-point division.
- `env-contract`: `groupEnvContracts()`, `normalizeEnvContractGroups()`, and `envContractManifest()` produce delimiter-safe
  metadata keys and surface/sensitivity lookups.
- `cookies`: `serializeCookie(name, value, attributes)` validates cookie grammar and requires the
  caller to supply every policy attribute. `SameSite=None` requires `Secure`.
  `parseCookies(header)` splits a `Cookie` request header into a name/value `Map`.
- `content-identity-cache`: `ContentAndIdentityCache` memoizes by object identity (WeakMap fast
  path) with a content-key fallback; the content key is a thunk and entries are never evicted.
- `http-signatures`: Node-only (`node:crypto`) Cavage-12 HTTP Signatures. Callers pass signed
  headers, allowed algorithms, and `maxAgeSeconds` on both sign and verify. The package has no
  default header set or product keyId policy.
- `oauth-pkce`: WebCrypto `generateCodeVerifier`, `generateState`, and S256 `generateCodeChallenge`.
- `oauth-popup` (browser): `openOAuthPopup`, `buildAuthorizationUrl`, `runPopupOAuthLogin`, and
  `OAuthCancelledError`. The flow takes an injectable `window`; callers keep their own in-flight
  guard and map the code, PKCE verifier, and redirect URI to their token shape.
- `oidc-id-token`: Node-only (`node:crypto`) RS256 ID-token verifier with an injected `fetch`, JWKS
  URI, issuers, and audiences. It caches the JWKS with a TTL, refreshes once on a `kid` miss, checks
  `iat` skew and an optional (hashed) nonce, and throws `OidcVerificationError` with a `code`.
  `googleProfileFromClaims`, `appleProfileFromClaims`, and `microsoftProfileFromClaims` map claims to a profile; account policy
  and HTTP error mapping stay in the application.
- `oauth-providers`: authorization-code redemption for GitHub, X, LinkedIn, Microsoft, Google, and Facebook. Each
  provider's `redeem(input, { fetch, signal, now })` returns `{ tokens, profile }`; `verifiedEmail`
  follows each provider's own rule. Microsoft verifies an ID token with the tenant JWKS and uses only an `email` claim with boolean
  `xms_edov: true` for `verifiedEmail`; Graph `mail` stays in profile data without verification. The
  authorization URL must request `microsoftAuthorizationScopes` (`openid email User.Read`) so Graph
  `/me` is authorized.
  Facebook keeps Graph email as unverified data and supports native tokens through
  `redeemAccessToken(token, ctx)`, which upgrades the token before fetching the profile.
  Credentials, tenant, and the egress-guarded `fetch` are injected; provider and HTTP failures
  throw `OAuthProviderError` (`provider`, `kind`, `status`), while Microsoft ID-token
  verification failures throw `OidcVerificationError` (`code`). Persistence and HTTP error
  mapping stay in the application.
- `collections`, `async`, and `stable-json`: collection deduplication/merging, bounded async mapping,
  and deterministic JSON serialization.
- `feature-flags`: base64 JSON feature-flag cookie parsing and serialization with caller-injected
  codecs, cookie names, and size policy.
- `dates`, `format`, `strings`, and `text-metrics`: UTC-day, duration, weighted-average and display
  formatting, text normalization, title casing, and word/sentence helpers.
- `gtin`, `bigint-ids`, and `validation`: GTIN predicates, canonical positive PostgreSQL bigint IDs,
  and basic email/UUID predicates.
- `moderation`: caller-configured report target, reason, identifier, note, and cross-field input
  validation. Applications own catalogs, policy, error mapping, persistence, and HTTP behavior.
- `query` and `query-string`: generic array/boolean/number parsing, bounded integer parsing, and
  query-string serialization. Cursor parsing intentionally belongs to `@vouchington/pagination`.
- `slugs` and `urls`: ASCII-only slugification, the `isSlug` lowercase `[a-z0-9-]+` predicate
  (leading, trailing, and consecutive hyphens are allowed), and URL/hostname primitives. URL hostname
  helpers return `null` for invalid input; `normalizeAsciiHostname` names its ASCII-only contract
  directly, while `normalizeHostname` also supports WHATWG IDN conversion.
  `matchesHostnamePattern` supports exact and inclusive `*.` hostname patterns.
- `hashtags`: caller-configured authored/key length and separator policy for canonical ASCII hashtag
  keys, plus `maskHashtagBearingUrls` to blank absolute URLs and fragment-bearing relative paths.
  The package does not choose application limits or accepted input separators.
- `utm`: `createUtmParser({ sourceAliases, fallbackSourceParam? })` lowercases and trims UTM fields
  and resolves `utm_source` through caller-owned aliases. The package has no default shortcode map.
- `fetch-ports`: the Fetch standard forbidden-port list and membership predicates.
- `api-errors`: the house JSON error envelope (`message`, optional `code`, `request_id`, `stack`),
  status/message/code extraction helpers, and `buildApiErrorEnvelope`, which redacts 5xx details
  unless the caller sets `exposeDetails`. Callers own serialization, logging, and environment policy.
- `api-response-contract`: identity markers (`apiResponse`, `apiRequest`, `apiQuery`, ...) and
  response-variant types read by a static contract extractor; no runtime effect.
- `http-body`: bounded Fetch response-body reads with abort propagation and typed missing/oversize
  errors.
- `http-link-pagination`: fail-closed RFC 8288 next-link parsing with same-origin URL and
  unambiguous cursor extraction.
- `language-tags`: caller-configured locale normalization and strict `Accept-Language` parsing and
  best matching. HTTP ranges reject malformed syntax and quality parameters; explicit `q=0` ranges
  exclude a candidate when they tie for that candidate's most-specific matching range, so `en;q=0`
  overrides an equal `en;q=1`, while `en-US;q=1` overrides broader `en;q=0` for supported `en-US`.
  A truncated fallback (`en-US` to supported `en`) instead uses the ranges that match `en`, so `en;q=0`
  or `*;q=0` excludes it. Matching compares an exact supported tag,
  then truncates the _request_ (`en-US` can match supported `en`); it never expands `en` to an
  arbitrary regional supported tag. Invalid configured tags are ignored. This subpath has no default
  locale or supported-tag policy.
- `message-catalog`: typed nested catalog translation for string, plural, and select-plural JSON
  descriptors. Catalog segments cannot contain dots because dots delimit nested keys. Plural values
  and configured number parameters must be finite numbers; callers own catalog content, locale
  choice, and number formatting.
- `observability`: SDK-free (structural types only) URL, request, breadcrumb, event, and span
  scrubbing plus a bounded spike-window tracker. All scrubbers are copy-on-write: unchanged input is
  returned by identity. Callers provide `credentialHeaders`, an optional `redactUrl` hook (applied
  after query and fragment stripping, for path-borne credentials), and an opt-in `dropRequestBody`.
  URL-only and credential-only passes are exported separately, and `composeBeforeSend` accepts
  either `ScrubOptions` or a final scrubber function. `scrubEvent` also makes a recursive pass over
  the whole event (`user`, `extra`, `contexts`, `tags`, `message`, exception values, breadcrumb
  messages and data): values under sensitive keys (authorization, cookie, password, secret, token,
  api/access key, email, dsn, credential) are replaced with `[Filtered]` (a plain object keeps its
  keys), and every string has bearer/basic credentials, `token=` style assignments, and email
  addresses redacted. `ScrubOptions` accepts additive `sensitiveKeyPatterns`, `textRedactors`, and
  `maxDepth` (default 12, minimum `MIN_MAX_DEPTH` = 8; deeper containers become `[Filtered]`, cycles become `[Circular]`). Dates,
  Errors, and other class instances are left as-is. `scrubDeep(value, options?)`, `redactText`, and
  `scrubBreadcrumb(breadcrumb, options)` are exported for direct use.

- `error-tree`: `formatErrorTree(error, { maxDepth?, maxNested? })` renders an error with its
  `errors[]` and `cause` chain, marks circular references, and reports how many nested errors the
  depth and count limits omitted (defaults 5 and 20).
- `job-data-scrub`: `scrubJobData(data, options?)`, a safe-scalar allowlist scrubber for queue job
  payloads. Only booleans, numbers, UUID/ULID ids, and short slug-like strings survive; sensitive
  keys redact regardless of value. The redaction marker (default `'[Filtered]'`), key substring and
  exact-name lists, and depth/array/key limits are options, and the defaults list only generic keys.
  It complements the key-based `observability` scrubbers.

```ts
const money = createMoneyCatalog([{ code: 'credit', minorUnitExponent: 2 }] as const, 6)
money.parseMajorUnitsToMoney('12.34', 'credit')
```

Applications supply all product identifiers, environment names, header names, policy, and catalogs.
