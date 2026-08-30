# vouchington-platform

Opinionated, open-source runtime packages for Vouchington-style websites.

This is a pnpm monorepo. Generic libraries (Valkey, SSRF, HTTP) live in other repos. Product schema
and routes stay in the application. Packages here encode house conventions without product table or
SKU names.

## Packages

| Package                                                            | Description                                                        |
| ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| [`@vouchington/postgres`](packages/postgres)                       | Triple-pool PostgreSQL runtime, transactions, cursors, migrations  |
| [`@vouchington/utils`](packages/utils)                             | Dependency-free explicit-subpath utilities, including i18n helpers |
| [`@vouchington/session-jwt`](packages/session-jwt)                 | Portable RS512 JWT primitives and UUIDv7 identifiers               |
| [`@vouchington/queue-errors`](packages/queue-errors)               | glide-mq retry classification and rate-limit helpers               |
| [`@vouchington/worker-runtime`](packages/worker-runtime)           | Queue selection, GlideMQ worker loading, and schedule registration |
| [`@vouchington/pagination`](packages/pagination)                   | Cursor codecs, guards, and configuration-owned query parsing       |
| [`@vouchington/csv`](packages/csv)                                 | BOM-safe parsing and spreadsheet-safe CSV serialization            |
| [`@vouchington/html-utils`](packages/html-utils)                   | HTML entity decoding and text helpers                              |
| [`@vouchington/phone-validation`](packages/phone-validation)       | Phone normalization and predicates                                 |
| [`@vouchington/uuid-v7`](packages/uuid-v7)                         | UUIDv7 generation, validation, and date bounds                     |
| [`@vouchington/frontmatter`](packages/frontmatter)                 | Deterministic YAML frontmatter serialization                       |
| [`@vouchington/http-transport`](packages/http-transport)           | Redirect-safe transport with injected fetch/address pinning        |
| [`@vouchington/image-resize`](packages/image-resize)               | Sharp byte transforms, metadata, and image format negotiation      |
| [`@vouchington/media`](packages/media)                             | Schema-less direct upload orchestration and S3 adapter             |
| [`@vouchington/wikimedia`](packages/wikimedia)                     | Injected Wikimedia search and page-summary client                  |
| [`@vouchington/memberships`](packages/memberships)                 | Schema-less membership lifecycle and provider primitives           |
| [`@vouchington/rate-limit`](packages/rate-limit)                   | Focused sliding-window Valkey rate-limit primitives                |
| [`@vouchington/browser-crawl`](packages/browser-crawl)             | Injected Playwright rendered-page collection                       |
| [`@vouchington/domain-verification`](packages/domain-verification) | DNS TXT and secure-transport well-known verification               |
| [`@vouchington/crawler-html`](packages/crawler-html)               | HTML content decoding and extraction                               |
| [`@vouchington/rss-parser`](packages/rss-parser)                   | RSS, Atom, and JSON feed parsing                                   |
| [`@vouchington/rss-crawler`](packages/rss-crawler)                 | Transport-injected feed crawling                                   |
| [`@vouchington/robots`](packages/robots)                           | Transport- and cache-injected robots.txt evaluation                |

## Commands

```sh
pnpm install
pnpm run lint
pnpm run typecheck
pnpm run build
pnpm test
pnpm run test:coverage
```

Postgres 18 is required for tests (`DATABASE_URL`, default
`postgres://postgres:postgres@127.0.0.1:5432/postgres`).

## Final code review

`Final Code Review / Code Reviewed` is a native, exact-PR-head gate. It waits for the current
head's `test` and `actionlint` checks, keeps forks and dependency bots secretless, and runs trusted
same-repository review providers only from the default-branch workflow definition. Provider and
review-posting failures are advisory; selection, settings, exact-head verification, required CI,
and label updates fail closed. `CODE_REVIEW_REQUIRED` is intentionally unsupported.

## Publishing

Normal releases use the `Release` workflow and npm trusted publishing (OIDC); there is no
`NPM_TOKEN`. A maintainer performs the one-time initial `0.0.0` bootstrap before configuring trust:
`npm publish ./packages/<directory> --access public`.
