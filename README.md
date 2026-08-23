# vouchington-platform

Opinionated, open-source runtime packages for Vouchington-style websites.

This is a pnpm monorepo. Generic libraries (Valkey, SSRF, HTTP) live in other repos. Product schema
and routes stay in the application. Packages here encode house conventions without product table or
SKU names.

## Packages

| Package                                      | Description                                                       |
| -------------------------------------------- | ----------------------------------------------------------------- |
| [`@vouchington/postgres`](packages/postgres) | Triple-pool PostgreSQL runtime, transactions, cursors, migrations |

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

Do not publish from a laptop. The `Release` workflow is `workflow_dispatch` and uses npm trusted
publishing (OIDC). There is no `NPM_TOKEN` on purpose.
