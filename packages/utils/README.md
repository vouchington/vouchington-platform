# @vouchington/utils

Dependency-free utilities for Node.js 24 applications. This package deliberately has no root
export: import the capability you use from an explicit subpath.

```ts
import { createTokenSecrets } from '@vouchington/utils/token-secrets'
import { createMoneyCatalog } from '@vouchington/utils/money'
import { serializeCookie } from '@vouchington/utils/cookies'
import { bestAcceptLanguageMatch } from '@vouchington/utils/language-tags'
import { createMessageTranslator } from '@vouchington/utils/message-catalog'
```

## Subpaths

- `token-secrets`: Node-only (`node:crypto`) purpose-bound HMAC and AES-256-GCM encryption.
  `createTokenSecrets({ hashSecret, encryptionKeys })` throws for invalid keys or ciphertext.
- `deploy-environment`: `getDeployEnvironment(source)` classifies explicit environment inputs without
  throwing.
- `url-signing`: Node-only HMAC SHA-256 `signPathWithKey(path, key)` and verification; invalid keys
  throw and invalid signatures return `false`.
- `request-client-info`: `createClientInfoParser(config)` validates caller-selected headers,
  families, platforms, compatibility, and versions.
- `money`: `createMoneyCatalog(currencies, scale)` supplies exact integer parsing and validation for
  the caller's catalog.
- `env-contract`: `groupEnvContracts()` and `normalizeEnvContractGroups()` produce delimiter-safe
  metadata keys and surface/sensitivity lookups.
- `cookies`: `serializeCookie(name, value, attributes)` validates cookie grammar and requires the
  caller to supply every policy attribute. `SameSite=None` requires `Secure`.
- `collections`, `async`, and `stable-json`: collection deduplication/merging, bounded async mapping,
  and deterministic JSON serialization.
- `feature-flags`: base64 JSON feature-flag cookie parsing and serialization with caller-injected
  codecs, cookie names, and size policy.
- `dates`, `format`, `strings`, and `text-metrics`: UTC-day, duration, weighted-average and display
  formatting, text normalization, title casing, and word/sentence helpers.
- `gtin`, `bigint-ids`, and `validation`: GTIN predicates, canonical positive PostgreSQL bigint IDs,
  and basic email/UUID predicates.
- `query` and `query-string`: generic array/boolean/number parsing, bounded integer parsing, and
  query-string serialization. Cursor parsing intentionally belongs to `@vouchington/pagination`.
- `slugs` and `urls`: ASCII-only slugification and URL/hostname primitives. URL hostname helpers
  return `null` for invalid input; `normalizeAsciiHostname` names its ASCII-only contract directly,
  while `normalizeHostname` also supports WHATWG IDN conversion. `matchesHostnamePattern` supports
  exact and inclusive `*.` hostname patterns.
- `hashtags`: caller-configured authored/key length and separator policy for canonical ASCII hashtag
  keys. The package does not choose application limits or accepted input separators.
- `fetch-ports`: the Fetch standard forbidden-port list and membership predicates.
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
- `observability`: SDK-free URL, request, event, and span scrubbing plus a bounded spike-window
  tracker. Callers provide credential headers and environment or spike policy; this package has no
  product defaults.

```ts
const money = createMoneyCatalog([{ code: 'credit', minorUnitExponent: 2 }] as const, 6)
money.parseMajorUnitsToMoney('12.34', 'credit')
```

Applications supply all product identifiers, environment names, header names, policy, and catalogs.
