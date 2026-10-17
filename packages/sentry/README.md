# @vouchington/sentry

Sentry SDK glue with every product value injected. Scrubbing lives in the dependency-free
`@vouchington/utils/observability`; this package composes it with the SDK types. The application
owns the SDK instance (`@sentry/core` is a peer; `@sentry/node` and `@sentry/browser` are optional
peers) and passes it in.

## Root export

- `createSentryInitOptions({ dsn, environment, enabledEnvironments, scrub, ... })` returns
  SDK-ready options: fail-closed enablement from an injected environment allowlist, `release`,
  `tracesSampleRate`, the least-data `dataCollection` policy, and a `beforeSend` pipeline of event
  filter, optional custom hook, `scrubEvent`, then spike protection. `beforeSendSpan` scrubs span
  attributes. `onMisconfigured` fires when an enabled environment has no DSN.
- `createDataCollectionPolicy({ credentialHeaders })` builds the Sentry v11 `dataCollection` policy.
  Client-IP headers are always denied; the credential header list is injected.
- `createEventFilter({ isExpected, minimumStatus, ignoredCodes, ignoredMessages })` drops tagged,
  expected, sub-500, and connection-noise events.
- `withSpikeProtection(beforeSend, { limit, windowMs, now })` bounds identical errors per window.
- `createSpanScrubber(scrub)` builds a `beforeSendSpan`.
- `createCodedError(status, message, code)` and the `Http*Error` classes
  (`HttpRateLimitError`, `HttpServerError`, `HttpResponseSizeError`, `HttpNoBodyError`).
- `captureError(client, error, { fallbackMessage, tags, extra, isExpected })`.

## `/node` and `/browser`

- `initNodeSentry(client, input)` and `captureAndFlush(client, error, options)` for servers,
  lambdas, and scripts.
- `initBrowserSentry(client, input)` (use `tunnel` for a same-origin envelope endpoint) and
  `captureError`.

Product alarms, DSN/release/environment sourcing, and tag choices stay in the application.
