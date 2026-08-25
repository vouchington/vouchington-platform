# @vouchington/utils

Dependency-free utilities for Node.js 24 applications. This package deliberately has no root
export: import the capability you use from an explicit subpath.

```ts
import { createTokenSecrets } from '@vouchington/utils/token-secrets'
import { createMoneyCatalog } from '@vouchington/utils/money'
import { serializeCookie } from '@vouchington/utils/cookies'
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
- `observability`: SDK-free URL, request, event, and span scrubbing. Callers provide credential
  headers and environment or spike policy; this package has no product defaults.

```ts
const money = createMoneyCatalog([{ code: 'credit', minorUnitExponent: 2 }] as const, 6)
money.parseMajorUnitsToMoney('12.34', 'credit')
```

Applications supply all product identifiers, environment names, header names, policy, and catalogs.
