# vouchington-platform

Opinionated, open-source runtime packages for Vouchington-style websites.

This is a pnpm monorepo. Generic libraries (Valkey, SSRF, HTTP) live in other repos. Product schema
and routes stay in the application. Packages here encode house conventions without product table or
SKU names.

## Packages

| Package                                      | Description                                                       |
| -------------------------------------------- | ----------------------------------------------------------------- |
| [`@vouchington/postgres`](packages/postgres) | Triple-pool PostgreSQL runtime, transactions, cursors, migrations |
| [`@vouchington/utils`](packages/utils)       | Dependency-free explicit-subpath runtime utilities                |

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
`npm publish ./packages/utils --access public`.
