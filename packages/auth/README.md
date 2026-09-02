# @vouchington/auth

Injected WebAuthn passkey ceremony primitives for Node.js applications. The package generates
registration and authentication options, verifies authenticator responses, and updates credential
counters. Applications supply persistence, one-time challenge state, RP identity, expected origins,
and failed-attempt limiting.

```ts
import { createPasskeys } from '@vouchington/auth'
```

## Boundaries

Passkey callers provide RP identity, expected origins, an atomic string challenge store, and a
credential repository. Discoverable authentication is sign-in only: an unknown credential fails
and never creates an identity.

Passkey storage accepts caller-owned registration context, such as a display name. State-key
builders and failed-attempt limiters can preserve an application's existing deployment contract.
Callers also provide a stable, non-PII WebAuthn user handle and explicitly choose every
ceremony-timeout, user-verification, resident-key, attestation, authenticator-attachment,
credential-algorithm, user-ID equality, and user-ID serialization policy.
Counter updates must atomically accept an advancing counter or a repeated zero for counterless
authenticators, allowing applications to record every successful use. Failed-attempt limiting
runs only after a credential-bearing assertion fails; malformed responses without a credential ID
and successful assertions do not consume that budget. String-ID applications can use
`createStringPasskeys` to supply equality and serialization without local adapters.

Default state keys percent-encode identifiers to avoid delimiter collisions. Applications migrating
live one-time state should inject key builders matching their existing keys until that state expires.
State-store `consume` implementations must atomically read and delete so concurrent ceremonies
cannot both succeed.

The package does not own HTTP handlers, session issuance, MFA continuation, OAuth, OTP, or
login-state transitions. Those remain application-owned.

## Provenance

Generalized from Filaments authentication services. Product tables, Valkey clients, email queues,
provider integrations, cookies, claims, and post-authentication side effects remain in Filaments.
