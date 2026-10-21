# Development

pnpm workspace. Node >= 24. Published packages live under `packages/`.

## Commands

```bash
pnpm install
pnpm run lint
pnpm run typecheck
pnpm run build
pnpm test
pnpm run test:coverage
```

`oxlint` is type-aware and denies warnings. Source files are capped at 200 lines; tests at 500.

Postgres 18 is required for package tests. CI starts `postgres:18`. Locally:

```bash
docker run --rm -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:18
```

Test files that run migrations must use `useIsolatedDatabase()` from `packages/postgres/src/test-helpers.mts`:
the migration advisory lock is per database, and `VITEST_MAX_WORKERS` overrides `fileParallelism: false`.

## Packages

- `@vouchington/auth` — injected WebAuthn passkey ceremony primitives
- `@vouchington/postgres` — PostgreSQL runtime factory
- `@vouchington/utils` — dependency-free explicit-subpath utilities
- `@vouchington/utils/sentry-envelope` and `/scopes` — injected envelope limits and scope catalogs
- `@vouchington/session-jwt` — portable RS512 JWT primitives
- `@vouchington/pagination` — cursor codecs, guards, and configurable query parsing
- `@vouchington/queue-errors` — GlideMQ retry classification and rate-limit helpers
- `@vouchington/worker-runtime` — queue selection, GlideMQ worker/schedule loading, and `/testing` Vitest harness
- `@vouchington/crawler-html` — HTML content decoding and extraction
- `@vouchington/embeds` — policy-injected HTML unfurl and oEmbed resolution
- `@vouchington/rss-parser` — RSS, Atom, and JSON feed parsing
- `@vouchington/rss-crawler` — transport-injected feed crawling
- `@vouchington/robots` — transport- and cache-injected robots.txt evaluation
- `@vouchington/browser-crawl` — injected Playwright rendered-page collection
- `@vouchington/domain-verification` — DNS TXT and secure-transport verification primitives
- `@vouchington/http-transport` — redirect-safe transport with injected fetch/address pinning
- `@vouchington/image-resize` — Sharp transforms, file output, metadata, and negotiation
- `@vouchington/media` — media validation, stream lifecycle, and injected S3 primitives
- `@vouchington/wikimedia` — injected Wikimedia search and page-summary client
- `@vouchington/memberships` — membership catalog, SKU grouping, and status utilities
- `@vouchington/typed-entities` — injected transaction-scoped typed entity semantics
- `@vouchington/request-contract-validation` — bundle-injected Ajv request carrier validation
- `@vouchington/rate-limit` — house layer over valkyries: api-server middleware, overlapped limits, and `/edge` Cloudflare bindings
- `@vouchington/api-client` — injected-config browser/server request wrappers, errors, admission idempotency, and a paginated-list hook

- `@vouchington/csv` — BOM-safe CSV parsing and spreadsheet-safe serialization
- `@vouchington/localization` — browser-safe catalog contracts, selectors, and fallback
- `@vouchington/localization-compiler` — SQLite compiler, CLI resolver, and native resource helpers
- `@vouchington/html-utils` — HTML entity and text helpers
- `@vouchington/html-sanitizer` — policy-injected HTML fragment sanitizer
- `@vouchington/phone-validation` — E.164 normalization and predicates
- `@vouchington/uuid-v7` — UUIDv7 creation, validation, date bounds, and base36 suffixes
- `@vouchington/dynamic-config` — role authorizer and snake_case admin view primitives for valkyries dynamic-config
- `@vouchington/stripe` — Stripe client factory, webhook verification, event narrowing, and param builders/parsers
- `@vouchington/dynamic-config` — registry, descriptor, validator, and injected-authorization admin layer over valkyries dynamic-config
- `@vouchington/edge` — Cloudflare Worker builders with injected routes, origins, and CSP sources
- `@vouchington/oauth-server` — OAuth 2.0 authorization-server primitives with injected stores
- `@vouchington/frontmatter` — Deterministic YAML frontmatter serialization
- `@vouchington/email` — React Email render helpers, style factories, injected catalog copy, and locale resolution
- `@vouchington/sentry` — Sentry SDK init options, least-data policy, event filtering, coded errors, and Node/browser capture helpers
- `@vouchington/ai` — subpath-only model-call primitives: `/providers` (usage, pricing, JSON-output adapters) and `/structured-decisions` (codecs, classification)
- `@vouchington/aws` — SES, SQS, Firehose, and CloudWatch command builders, batching, codecs, and throttling classifiers

Do not extract shadcn/ui components: applications generate and own them with the shadcn CLI. Custom, product-agnostic React components, hooks, and helpers that are not shadcn output may be extracted under the normal rules.

Extracted APIs must be opinionated generic utilities, never business-logic orchestration. Generic
orchestration utilities are fine when they know nothing about the domain and callers inject the
work: retry loops, per-item transaction runners, middleware installers, idempotency managers, and
dependency-ordered appliers. An extraction must earn its place: it must reduce lines of code in its
dependents without adding indirection to their business logic. Business workflows, domain state transitions, product identifiers,
product defaults, policy, persistence, and authorization belong in application adapters. Packages may encode safe, reusable implementation defaults when callers
can override product-facing choices. Code with no third-party runtime dependencies belongs in an explicit
`@vouchington/utils/<subpath>` export. Code requiring any third-party runtime dependency must be its
own `@vouchington/<name>` package and declare that dependency there. Node built-ins do not count as
third-party dependencies.

Record the source SHA and path list in the commit body when copying from the product monorepo.

`@vouchington/utils/http-signatures` is a Node-only Cavage-12 engine. Callers inject signed
headers, algorithms, and maxAge on both sign and verify. Applications own keyId URIs, PEM
decrypt, persistence, and delivery.

`@vouchington/typed-entities` is the exception to the normal explicit-subpath utility convention:
its cohesive public API is root-export-only. Applications own entity type strings, schema, policy,
authorization, and transaction implementation; the package owns only generic semantic invariants.

Use `pr-shepherd` (not `gh pr checks`) to iterate pull requests.

## Publishing

Normal releases are workflow-only: `Release` publishes with npm trusted publishing (OIDC).
For a new package only, a maintainer may bootstrap `0.0.0` before trust configuration with
`npm publish ./packages/<directory> --access public`; all later releases remain OIDC-only.
`RELEASE_TOKEN` needs Contents Read & Write for the version-bump push and GitHub release.

## Agent Blackboard

Journal sessions through the machine-registered `vouchington-tooling` MCP server, installed by
[vouchington-machines](https://github.com/vouchington/vouchington-machines/blob/main/docs/agent-config.md),
together with the `vouchington-workflow:blackboard` skill. This repository registers no
blackboard MCP server, plugin, marketplace, or tool grant of its own. Session ids, agent/version identities, and parent-session ids must
be explicit; never infer or generate them from host state. Use only the client credential supplied
by `AGENT_BLACKBOARD_TOKEN` with `AGENT_BLACKBOARD_URL`; fail closed when either credential is
missing, malformed, or unavailable, and never substitute an admin credential.
