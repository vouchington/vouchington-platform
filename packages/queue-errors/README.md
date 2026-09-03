# @vouchington/queue-errors

General-purpose error classification helpers for [glide-mq](https://www.npmjs.com/package/glide-mq)
workers. This package owns queue mechanics only: applications supply provider-specific status
extraction, rate-limit detection, and cooldown policy.

## Install

```sh
pnpm add @vouchington/queue-errors glide-mq
```

GlideMQ is a peer dependency so workers and these helpers share the same control-flow error
classes.

## HTTP retry classification

`wrapHttpForRetry` makes ordinary HTTP 4xx errors terminal by throwing GlideMQ's
`UnrecoverableError`. It rethrows timeouts (408), rate limits (429), 5xx, and failures with no
recognized status so GlideMQ can apply its configured retry policy.

```ts
import { wrapHttpForRetry } from '@vouchington/queue-errors'

await callProvider().catch(wrapHttpForRetry)
```

Use `getStatus` for provider-specific error shapes and `isRetryableStatus` to choose which client
responses are transient. Supplying `isRetryableStatus` replaces the default 408/429/5xx policy for
every recognized 400–599 status, so the callback must return `true` for each status that your
application considers transient.
`unrecoverable(error, message?, options?)` explicitly marks any failure terminal.

Applications that resolve a different `glide-mq` copy than this package can pass
`UnrecoverableError` and `RateLimitError` constructors so thrown errors match the
application’s `instanceof` checks. Defaults remain this package’s glide-mq classes. The injected
terminal constructor must accept a required `message: string` parameter, matching glide-mq's own
`UnrecoverableError`; the injected rate-limit constructor takes no arguments.

```ts
import { UnrecoverableError, Worker } from 'glide-mq'
import { handleRateLimitedError, unrecoverable, wrapHttpForRetry } from '@vouchington/queue-errors'

unrecoverable(error, 'terminal', { UnrecoverableError })
wrapHttpForRetry(error, { UnrecoverableError, getStatus })
await handleRateLimitedError(error, worker, {
  cooldownMs,
  isRateLimited,
  UnrecoverableError,
  RateLimitError: Worker.RateLimitError,
})
```

## Provider rate limits

When a provider returns a rate limit, pause the worker for the application-selected cooldown and
throw GlideMQ's control-flow error so the current job is scheduled after the cooldown. GlideMQ's
normal retry accounting applies, so applications should configure attempts accordingly.

```ts
import { handleRateLimitedError } from '@vouchington/queue-errors'

try {
  await callProvider()
} catch (error) {
  await handleRateLimitedError(error, worker, {
    cooldownMs: retryAfterMs,
    isRateLimited: (value) => getProviderStatus(value) === 429,
  })
}
```

`cooldownMs` must be a positive safe integer. The package does not choose provider names,
identifiers, throttling rules, or fallback policy. Provider exception names, SDK-specific metadata
extraction, and fixed cooldowns belong in an application adapter.
