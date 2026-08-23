# @vouchington/session-jwt

Portable Node.js 24+ RS512 JWT primitives: validated JWK key sets with rotation, signing,
verification, decoding, and UUIDv7 identifiers.

This package owns JWT mechanics only. Applications supply private/public JWKs, issuer, audiences,
claims, expirations, and all authentication policy. It reads no environment variables, ships no
private key, and has no fallback key material.

## Install

```sh
pnpm add @vouchington/session-jwt
```

## Sign and verify

```ts
import { createJwtKeySet, signJwt, verifyJwt } from '@vouchington/session-jwt'

const keySet = await createJwtKeySet({ privateJwks: applicationPrivateJwks })
const token = await signJwt(
  { subject: 'person-1' },
  {
    keySet,
    issuer: 'https://example.test',
    audience: 'example-client',
    expiresIn: '1h',
  },
)
const payload = await verifyJwt(token, {
  keySet,
  issuer: 'https://example.test',
  audience: 'example-client',
})
```

`createJwtKeySet` uses the first private key to sign and every public key to verify, enabling safe
rotation. Construction completes only after every key imports successfully. JWKs must use RSA
moduli of at least 2048 bits, `alg: 'RS512'`, role-compatible `key_ops`, and unique non-empty `kid`
values. Use `JwtKeySetCache` when a long-lived caller wants identity-based memoization with explicit
`delete` and `clear` lifecycle controls; the default constructor retains no key material globally.

Malformed tokens, unknown keys, invalid signatures, expiry, issuer, audience, and failed payload
validators make `verifyJwt` return `null`. Invalid configuration throws. Without a payload validator,
verification returns `JWTPayload`; a caller-supplied type predicate narrows the result safely.

`decodeJwt(token)` only parses untrusted claims. It does not verify the signature, expiry, issuer, or
audience and its result must never be used to authorize access.

## Identifiers

`mintUuidv7`, `isUuidv7`, and `validateUuidv7` provide UUIDv7 helpers without application identifier
semantics. Dependency-free cookie serialization lives at `@vouchington/utils/cookies`.
