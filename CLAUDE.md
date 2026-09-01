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

## Packages

- `@vouchington/postgres` — PostgreSQL runtime factory
- `@vouchington/utils` — dependency-free explicit-subpath utilities
- `@vouchington/session-jwt` — portable RS512 JWT primitives
- `@vouchington/pagination` — cursor codecs, guards, and configurable query parsing
- `@vouchington/queue-errors` — GlideMQ retry classification and rate-limit helpers
- `@vouchington/crawler-html` — HTML content decoding and extraction
- `@vouchington/embeds` — policy-injected HTML unfurl and oEmbed resolution
- `@vouchington/rss-parser` — RSS, Atom, and JSON feed parsing
- `@vouchington/rss-crawler` — transport-injected feed crawling
- `@vouchington/robots` — transport- and cache-injected robots.txt evaluation
- `@vouchington/browser-crawl` — injected Playwright rendered-page collection
- `@vouchington/domain-verification` — DNS TXT and secure-transport verification primitives
- `@vouchington/media` — media validation, stream lifecycle, and injected S3 primitives
- `@vouchington/rate-limit` — focused sliding-window Valkey rate-limit primitives
- `@vouchington/typed-entities` — injected transaction-scoped typed entity semantics

- `@vouchington/csv` — BOM-safe CSV parsing and spreadsheet-safe serialization
- `@vouchington/html-utils` — HTML entity and text helpers
- `@vouchington/phone-validation` — E.164 normalization and predicates
- `@vouchington/uuid-v7` — UUIDv7 creation, validation, date bounds, and base36 suffixes
- `@vouchington/frontmatter` — Deterministic YAML frontmatter serialization

Extracted APIs must be opinionated generic utilities, never orchestration or workflows. State
transitions, transaction and ordering decisions, queue and retry behavior, HTTP lifecycle, cleanup
coordination, product identifiers, product defaults, policy, persistence, and authorization belong
in application adapters. Packages may encode safe, reusable implementation defaults when callers
can override product-facing choices. Code with no third-party runtime dependencies belongs in an explicit
`@vouchington/utils/<subpath>` export. Code requiring any third-party runtime dependency must be its
own `@vouchington/<name>` package and declare that dependency there. Node built-ins do not count as
third-party dependencies.

Record the source SHA and path list in the commit body when copying from the product monorepo.

`@vouchington/typed-entities` is the exception to the normal explicit-subpath utility convention:
its cohesive public API is root-export-only. Applications own entity type strings, schema, policy,
authorization, and transaction implementation; the package owns only generic semantic invariants.

Use `pr-shepherd` (not `gh pr checks`) to iterate pull requests.

## Publishing

Normal releases are workflow-only: `Release` publishes with npm trusted publishing (OIDC).
For a new package only, a maintainer may bootstrap `0.0.0` before trust configuration with
`npm publish ./packages/<directory> --access public`; all later releases remain OIDC-only.
`RELEASE_TOKEN` needs Contents Read & Write for the version-bump push and GitHub release.
