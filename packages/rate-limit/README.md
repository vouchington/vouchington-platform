# @vouchington/rate-limit

A house layer over [`valkyries`](https://github.com/jonathanong/valkyries) `RateLimiter` and
`@jongleberry/api-server`. It is not a second limiter: counting stays in valkyries, and gaps in the
generic limiter belong upstream there.

Routes, limits, identity sources, backends, and namespaces are all injected by the application.
`valkyries` and `@jongleberry/api-server` are peer dependencies (the package only uses their types).

## Root export

- `createRouteRateLimiter({ getBackend, resolvePolicy, onError, hashedDimensions })` returns
  `check(routeKey, identities, context)`. Every non-empty identity becomes one
  `{dimension}:{value}:{route}` key, charged atomically with one `addAndCheck`. Backend errors go to
  `onError`; the request fails open unless the policy sets `failClosed`. Pass
  `check(routeKey, identities, context, { cost })` to charge `cost` units all or nothing with one
  `consume`: every identity is charged or none is, and `retryAfterSeconds` is the time until the
  window frees enough room.
- `buildRateLimitKeys`, `sanitizeRouteKeySegment` — the key builder, with optional hashed dimensions.
- `installRouteRateLimit(app, options)` — adds `applyRouteRateLimit`, `prepareRouteRateLimit`, and
  `settleRouteRateLimit` to the api-server `Context`. The application supplies `resolveIdentities`,
  `check`, an optional `isEnabled`, and an optional `onSettled` hook (e.g. usage metering).
- `withOverlappedRateLimit(ctx, routeKey, load)` — charges the limiter while `load` runs and defers
  headers and 429 to `settleRateLimit()`, so status precedence stays with the caller.
- `applyRateLimitResult(ctx, result)` — `X-RateLimit-*`, `Retry-After`, and 429.
- `chargeRoutes(charges, check)` — sequential per-unit charging across several routes, stopping a
  unit at its first spent route. A charge's optional `weight` is passed to `check` as its cost, so a
  batch charges once instead of once per item. Each route is all or nothing; routes are not atomic
  together.

## `@vouchington/rate-limit/edge`

Helpers over Cloudflare rate-limit bindings: `checkEdgeBuckets`, `getEdgeRateLimitRejection`,
`buildEdgeRateLimitKey`, `hasAnyRateLimitBinding`, and the namespace-collision check
`findRateLimitNamespaceCollisions` plus `runRateLimitNamespaceCollisionCli`. Buckets, key shapes,
bypass rules, and rejection responses are injected.

## License

MIT
