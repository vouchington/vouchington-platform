# vouchington-platform

Opinionated, open-source runtime packages for Vouchington-style websites.

This is a pnpm monorepo. Generic libraries (Valkey, SSRF, HTTP) live in other repos. Product schema
and routes stay in the application. Packages here encode house conventions without product table or
SKU names.

## Packages

| Package                                                            | Description                                                        |
| ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| [`@vouchington/auth`](packages/auth)                               | Injected OTP, passkey, MFA/TOTP, and OAuth authentication engines  |
| [`@vouchington/postgres`](packages/postgres)                       | PostgreSQL runtime, migrations, and structural schema snapshots    |
| [`@vouchington/utils`](packages/utils)                             | Dependency-free explicit-subpath utilities, including i18n helpers |
| [`@vouchington/session-jwt`](packages/session-jwt)                 | Portable RS512 JWT primitives and UUIDv7 identifiers               |
| [`@vouchington/queue-errors`](packages/queue-errors)               | glide-mq retry classification and rate-limit helpers               |
| [`@vouchington/worker-runtime`](packages/worker-runtime)           | Queue selection, GlideMQ worker loading, and schedule registration |
| [`@vouchington/pagination`](packages/pagination)                   | Cursor codecs, guards, and configuration-owned query parsing       |
| [`@vouchington/moderation`](packages/moderation)                   | Configurable report intake, queue claims, and route factories      |
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
| [`@vouchington/reviews`](packages/reviews)                         | Policy-injected schema-less review lifecycle and ratings engine    |
| [`@vouchington/browser-crawl`](packages/browser-crawl)             | Injected Playwright rendered-page collection                       |
| [`@vouchington/domain-verification`](packages/domain-verification) | DNS TXT and secure-transport well-known verification               |
| [`@vouchington/crawler-html`](packages/crawler-html)               | HTML content decoding and extraction                               |
| [`@vouchington/embeds`](packages/embeds)                           | Policy-injected HTML unfurl and oEmbed resolution                  |
| [`@vouchington/rss-parser`](packages/rss-parser)                   | RSS, Atom, and JSON feed parsing                                   |
| [`@vouchington/rss-crawler`](packages/rss-crawler)                 | Transport-injected feed crawling                                   |
| [`@vouchington/robots`](packages/robots)                           | Transport- and cache-injected robots.txt evaluation                |
| [`@vouchington/typed-entities`](packages/typed-entities)           | Transaction-scoped typed entity aliases, hierarchy, and hostnames  |

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

## Publishing

Normal releases use the `Release` workflow and npm trusted publishing (OIDC); there is no
`NPM_TOKEN`. A maintainer performs the one-time initial `0.0.0` bootstrap before configuring trust:
`npm publish ./packages/<directory> --access public`.
