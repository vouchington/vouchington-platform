# @vouchington/auth

Composable authentication protocols for Node.js applications. The package supplies email OTP,
WebAuthn passkeys, TOTP/MFA state, OAuth connect/continue orchestration, and an optional JWT session
issuer. Applications supply persistence, one-time state, provider implementations, identity
policy, delivery, rate limiting, and session cookies.

```ts
import { createEmailOtp, createPasskeys } from '@vouchington/auth'
import { createEmailOtpHandlers } from '@vouchington/auth/api-server'
```

## Boundaries

The root export has no HTTP-framework dependency at runtime. `@vouchington/auth/api-server` adapts
application operations to `@jongleberry/api-server` handlers without choosing route paths, cookie
names, provider names, response schemas, or authorization policy.

Passkey callers provide RP identity, expected origins, an atomic challenge store, and a credential
repository. Discoverable authentication is sign-in only: an unknown credential fails and never
creates an identity. TOTP is optional. OAuth providers are resolved from a caller-owned registry.
The optional `createJwtSessionIssuer` composes `@vouchington/session-jwt`; applications with richer
session policy may inject their own issuer into `createAuthenticationFlow`.

Persistence and policy are ports rather than built-ins:

- OTP delivery, hashing, storage, and request/verification limiters are injected.
- Passkey storage accepts caller-owned registration context, such as a display name. State-key
  builders and failed-attempt limiters can preserve an application's existing deployment contract.
  Callers also provide a stable, non-PII WebAuthn user handle and explicitly choose every
  user-verification policy.
  Counter updates must atomically advance only when the stored counter is lower.
- TOTP verification requires a caller-owned store that atomically advances the factor's last-used
  time-step counter, preventing a valid code from completing multiple login attempts.
- MFA state supports caller-owned keys and identifier validation. `createMfaFlow` checks limits,
  verifies a factor, keeps failed attempts available, atomically consumes successful attempts, and
  delegates session completion.
- OAuth provider availability, account persistence, user connection, and login continuation remain
  caller-owned.

Default state keys percent-encode identifiers to avoid delimiter collisions. Applications migrating
live one-time state should inject key builders matching their existing keys until that state expires.

`@vouchington/auth/api-server` returns handlers rather than registering global routes. Applications
choose paths, parse product-specific body schemas inside operations, and retain ownership of cookies
and response shapes. Operations can override response serialization for redirects, cookies, and
other non-JSON callbacks. JSON handlers require `application/json` and cap request bodies at 100 KB;
the MFA status handler is body-free.

Password authentication is not included in this initial release.

## Provenance

Generalized from Filaments authentication services. Product tables, Valkey clients, email queues,
provider integrations, cookies, claims, and post-authentication side effects remain in Filaments.
