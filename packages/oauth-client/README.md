# @vouchington/oauth-client

OAuth client building blocks that need third-party dependencies. The `/atproto` subpath wraps
`@atproto/oauth-client-node` and is Node-only. Zero-dependency OAuth helpers (PKCE, popup flow,
provider redemption, ID-token verification) live in `@vouchington/utils`.

`@atproto/oauth-client-node` is a peer dependency because its store types appear in this
package's public API.

```ts
import { createAtprotoOAuthClient, parseEcKeyset } from '@vouchington/oauth-client/atproto'

const keyset = await parseEcKeyset({
  env: process.env.ATPROTO_PRIVATE_KEYS_B64 ?? '',
  mode: 'production',
})

const client = createAtprotoOAuthClient({
  clientMetadata, // your metadata document, including the public jwks
  keyset,
  stateStore,
  sessionStore,
  fetch: guardedFetch,
})
```

- `parseEcKeyset({ env, mode, fallbackKey?, envName? })` reads base64 JSON as an array of JWKs, a
  `{ keys }` document, or a single JWK. Keys must be EC P-256 private keys (`ES256` when `alg` is
  set) with a unique `kid`. Production requires `env`. Outside production an empty `env` uses the
  `fallbackKey` you inject; the package ships no key. Results are memoized per mode, name, env
  value, and fallback key. `envName` only appears in error messages.
- `createAtprotoOAuthClient({ clientMetadata, keyset, stateStore, sessionStore, fetch,
  operationSignal?, requestLock? })` builds a `NodeOAuthClient`. Requests use
  `unicastFetchWrap` over your `fetch`, which rejects loopback and other non-unicast addresses.
  `operationSignal` is combined with each request's own signal. The handle resolver receives your
  unwrapped `fetch` because it applies its own address checks. Without `requestLock` the SDK uses
  an in-process lock, so supply one if several processes refresh the same session.

The client metadata document, state and session stores, egress policy, and persistence stay in the
application.
