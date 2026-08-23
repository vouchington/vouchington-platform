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

Extracted APIs must be generalizable and parameterized; product identifiers, defaults, and policy
belong in application adapters. Code with no third-party runtime dependencies belongs in an explicit
`@vouchington/utils/<subpath>` export. Code requiring any third-party runtime dependency must be its
own `@vouchington/<name>` package and declare that dependency there. Node built-ins do not count as
third-party dependencies.

Record the source SHA and path list in the commit body when copying from the product monorepo.

Use `pr-shepherd` (not `gh pr checks`) to iterate pull requests.

## Publishing

Normal releases are workflow-only: `Release` publishes with npm trusted publishing (OIDC).
For a new package only, a maintainer may bootstrap `0.0.0` before trust configuration with
`npm publish ./packages/<directory> --access public`; all later releases remain OIDC-only.
`RELEASE_TOKEN` needs Contents Read & Write for the version-bump push and GitHub release.
