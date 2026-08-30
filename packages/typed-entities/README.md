# @vouchington/typed-entities

Generic, transaction-scoped semantics for applications whose entities share alias, hierarchy, and
hostname behavior. The application owns its entity types, schema, authorization, persistence, and
business policy. This package owns only the portable invariants.

```ts
import { createTypedEntityEngine } from '@vouchington/typed-entities'

const entities = createTypedEntityEngine({
  catalog: {
    organization: {
      canMerge: ({ context }) => context.canMerge,
    },
    location: {},
  },
  store,
})

await entities.claimAlias(context, 'organization-1', 'Acme')
await entities.addParent(context, 'location-1', 'organization-1')
await entities.claimPrimaryHostname(context, 'organization-1', 'acme.example')
```

## Persistence contract

Every mutation runs inside `store.transact`. Adapters provide deterministic entity, alias, hierarchy,
and hostname locks plus the primitive reads and writes declared by `TypedEntityTransaction`. A
failed operation must roll back all writes.

`merge` normalizes and deduplicates the source slug and aliases, locks them in sorted order, checks
every conflict, transfers them, then applies the application-owned lifecycle projection. Hierarchy
operations support multiple parents and reject self or indirect cycles while holding the adapter's
hierarchy lock.

Primary and additional hostname claims are exclusive across entities. An application can opt into
reclaiming a missing or stale owner through `mayReclaimHostname`. Primary and additional hostname
associations are separate, non-exclusive records for source/reference use cases.

`hooks.audit` runs inside the transaction. `hooks.afterCommit` receives the completed change set
only after the transaction succeeds, making it suitable for application-owned cache and queue work.

Aliases use `normalizeKey` from `@vouchington/utils/strings` by default, and hostnames use
`normalizeAsciiHostname` from `@vouchington/utils/urls`. Applications can inject stricter
normalizers. Domain failures extend `TypedEntityError` and expose stable `code` values.

The package contains no SQL, routes, application type strings, authorization implementation,
caches, or queues.
