# @vouchington/rate-limit

Generic [Valkey](https://valkey.io/) rate-limiting primitives backed by
[Valkyries](https://www.npmjs.com/package/valkyries). Applications provide their own keys,
thresholds, windows, clients, and response policy.

## Install

```sh
pnpm add @vouchington/rate-limit
```

## Rate limiting

`RateLimiter` records and counts caller-provided identifiers. Construct it with an application
prefix and TTL, then choose the identifiers and threshold at each call site.

```ts
import { RateLimiter } from '@vouchington/rate-limit'

const limiter = new RateLimiter({ prefix: 'api', ttlSeconds: 60 })
const { limited } = await limiter.addAndCheck(['account:123'], 100)
```

`RateLimiter.addAndCheckWindows` supports atomic multi-window checks. `RateLimiterOptions`,
`RateLimiterWindow`, and `RateLimiterAddAndCheckWindowsOptions` describe the available options.
Pass a caller-managed client when the application owns connection lifecycle. Importing the package
also initializes Valkyries-managed lazy clients for the default-client path. Applications must call
`closeManagedValkeyClients()` during shutdown; it closes every package-managed Valkyries client in
the process, while caller-injected clients remain caller-owned.

```ts
import { closeManagedValkeyClients } from '@vouchington/rate-limit'

await closeManagedValkeyClients()
```

## Saturation retries

`retryRateLimiterSaturation` retries only Valkey client inflight-saturation rejections. Callers can
set the attempt count and minimum delay; otherwise Valkyries defaults apply. The helper does not
choose key formats, thresholds, or how an application responds to a limit.

```ts
import { retryRateLimiterSaturation } from '@vouchington/rate-limit'

const result = await retryRateLimiterSaturation(() => client.invokeScript(script, options), {
  attempts: 3,
  delayMs: 100,
})
```
