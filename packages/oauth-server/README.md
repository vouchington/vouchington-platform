# @vouchington/oauth-server

Framework-agnostic OAuth 2.0 authorization-server building blocks: RFC 6749 (code and refresh
grants), RFC 7591 (dynamic client registration), RFC 7636 (PKCE, S256 only), RFC 7009 (revocation),
RFC 8414 / 9728 (metadata), RFC 8707 (resource indicators), and RFC 9207 (`iss` on responses).

The package never touches HTTP frameworks or databases. The application injects:

- `ClientStore` / `ClientRegistry` — client lookup (return only active, eligible clients) and creation.
- `GrantStore` — authorization-code and refresh-token persistence. `redeemAuthorizationCode` and
  `redeemRefreshToken` run the package's verification callback inside the adapter's own
  transaction and lock; the adapter persists the returned tokens and spends the secret atomically,
  flags reuse with `replayed: true`, and decides what a replay or failed attempt revokes.
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

`IssuedTokens.scopes` are the access-token scopes (narrowed when a refresh request narrows them);
persist `IssuedTokens.refreshScopes` on the rotated refresh token so the grant is never narrowed.
Authorization `state` is capped at 1024 characters; pass `maxStateLength` to
`validateAuthorizationRequest` and `authorizationErrorRedirect` to change it. Default metadata
endpoints ignore trailing slashes on the issuer. `buildOAuthErrorResponse` quotes the realm and
throws a `TypeError` when it contains control characters.
