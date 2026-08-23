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

Extracted code must contain no product identifiers. Repo-specific values are parameters or env vars.

Record the source SHA and path list in the commit body when copying from the product monorepo.

Use `pr-shepherd` (not `gh pr checks`) to iterate pull requests.

## Publishing

Do not publish from a laptop. The `Release` workflow is `workflow_dispatch` and publishes with npm
trusted publishing (OIDC). `RELEASE_TOKEN` needs Contents Read & Write on this repository for the
version-bump push and GitHub release. There is no `NPM_TOKEN` on purpose.
