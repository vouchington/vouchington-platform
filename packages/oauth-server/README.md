# @vouchington/oauth-server

Framework-agnostic OAuth 2.0 authorization-server building blocks: RFC 6749 (code and refresh
grants), RFC 7591 (dynamic client registration), RFC 7636 (PKCE, S256 only), RFC 7009 (revocation),
RFC 8414 / 9728 (metadata), RFC 8707 (resource indicators), and RFC 9207 (`iss` on responses).

The package never touches HTTP frameworks or databases. The application injects:

- `ClientStore` / `ClientRegistry` — client lookup (return only active, eligible clients) and creation.
- `GrantStore` — authorization-code and refresh-token persistence. `consumeAuthorizationCode` and
  `consumeRefreshToken` must atomically mark the secret spent and set `replayed: true` on reuse, so
  codes and rotated refresh tokens are single use. The application decides what a replay revokes.
- `HashSecret` — one-way hash for client secrets, codes, and tokens. Only hashes reach the stores.
- `ScopePolicy` — a `ScopeCatalog` from `@vouchington/utils/scopes` plus the catalog surface.
- `resolveResource` — maps a `resource` URL to `{ url, audience }` or `null`.
- Consent, retention, ownership, rate limiting, and request routing.

```ts
import {
  exchangeTokenGrant,
  parseClientAuthentication,
  parseFormBody,
} from '@vouchington/oauth-server'

const form = parseFormBody(contentType, body)
const credentials = parseClientAuthentication(authorizationHeader, form)
const tokens = await exchangeTokenGrant(form, credentials, { clients, grants, scopes, hashSecret })
```

Errors are `OAuthProtocolError`; `buildOAuthErrorResponse(error)` renders the RFC 6749 section 5.2
body, status, and `WWW-Authenticate` challenge. Redirect URIs match by exact string, except RFC 8252
loopback registrations that omit the port. Secret and PKCE comparisons are timing-safe.
