# @vouchington/votes

Schema-owned, injectable append-only vote primitives for PostgreSQL applications. The package
does not create tables, choose ballot names, authorize users, or apply product policy.

## Install

```sh
pnpm add @vouchington/votes @vouchington/postgres
```

`@jongleberry/api-server` is optional and only needed for the `@vouchington/votes/api-server`
adapter. Importing the root package never loads it.

## Store

Bind the store to a `Psql` instance and static, unqualified identifiers. The table is owned and
migrated by the application. It must have this contract (replace `entity_id` with the configured
column):

```sql
CREATE TABLE article_votes (
  id UUID DEFAULT uuidv7() PRIMARY KEY,
  user_id UUID NOT NULL,
  entity_id UUID NOT NULL,
  score SMALLINT,
  ip_address INET,
  device_id UUID,
  session_id UUID,
  user_agent_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ON article_votes (user_id, entity_id, id DESC);
CREATE INDEX ON article_votes (entity_id, user_id, id DESC);
```

IDs must sort in insertion order; PostgreSQL 18's `uuidv7()` satisfies that requirement. Foreign
keys and audit-table relations remain application concerns.

```ts
const votes = createVoteStore(psql, {
  table: 'article_votes',
  entityIdColumn: 'article_id',
  resolveUserAgentId: async (userAgent, query) => {
    // Use query so audit work joins the vote transaction.
    return null
  },
})

await votes.upsert(userId, [{ entityId, score: 1 }], {
  userAgent: request.headers.get('user-agent'),
})
```

`upsert()` deduplicates input with last-value-wins semantics, locks IDs in deterministic order,
does not append unchanged ballots, and honors `QueryOptions` transaction reuse. `clear()` appends
a `NULL` score unless the current ballot is already clear. `getCurrent()` reads the primary for
mutation correctness; `getByUser()` and paginated projections read the replica. Cursor scopes
include the requested user/entity IDs to prevent replay across principals. Pages return camel-case
`pageInfo` from `@vouchington/pagination`.

## HTTP engine

`createVoteHandler()` and `createVoteClearHandler()` are framework-neutral. They receive an
adapter for extracting a user, body, request metadata, status setting, route limiting, and
application-specific assertions. Callers supply a choice codec, entity getter, access hooks,
rate limiter, policy hooks, and persistence function. The API-server subpath supplies an adapter
for `@jongleberry/api-server` contexts.

When choices have a one-to-one score mapping, the default no-op check compares the current score.
Applications with semantic choices that share a score can return their own current-ballot type and
inject `isNoop` to compare choices instead.

The default store targets the common columns above. Applications with extra ballot-provenance or
federation columns keep those persistence projections in an application adapter and inject its
`upsert` and `getCurrent` functions into the same handler engine.

No Filaments entities, table names, score enums, migrations, tally aggregation, or partitioned
relation writes are part of this package.

## Provenance

The implementation was generalized from Filaments commit
`ae1665b45a35bec1cc2c57df9c1f32ca30f46900`, principally from the shared vote upsert, get, query,
route utility, request lock, and handler modules. Application-specific policies and side effects
were intentionally left behind and are represented by injected hooks.
