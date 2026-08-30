# @vouchington/typed-entities

Pure, schema-less rules for applications with aliases, entity merges, parent hierarchies, and
exclusive hostname claims. The package performs no I/O and owns no transaction, database, entity
type, authorization, lifecycle, audit, queue, or cache behavior.

```ts
import { planAliasMerge, planHostnameClaim } from '@vouchington/typed-entities'

const merge = planAliasMerge({
  destinationId: 'organization-2',
  owners: [{ alias: 'acme', entityId: 'organization-1' }],
  sourceAliases: [],
  sourceId: 'organization-1',
  sourceSlug: 'Acme',
})
// { aliases: ['acme'] }

const hostname = planHostnameClaim({
  currentPrimary: null,
  entityId: 'organization-2',
  kind: 'primary',
  requestedClaim: null,
  value: 'acme.example',
})
```

## Rules

- `normalizeAlias` and `normalizeHostname` use Vouchington's generic normalizers by default, and
  accept an injected stricter normalizer when an application needs one.
- `planAliasClaim` rejects a foreign owner and returns whether an unclaimed alias needs writing.
- `planAliasMerge` rejects self-merges and third-party alias ownership. It includes the source
  slug, normalizes and deduplicates the aliases, then returns the aliases to transfer.
- `planHostnameClaim` enforces exclusive ownership, primary/additional transitions, replacement of
  an entity's prior primary claim, and explicitly permitted reclamation. The application decides
  whether a stale or inactive foreign owner is reclaimable. `requestedClaim` is the existing claim
  on the requested hostname; `currentPrimary` is the claimant's existing primary claim. Additional
  claims coexist and are not replaced by another additional claim.
- `assertAcyclicParent` rejects self and indirect hierarchy cycles from an application-provided
  list of IDs reachable upward from the proposed parent.

Applications load and lock state, invoke these functions, and apply the resulting plan in their
own transaction. Hostname display/reference associations are application data; this package models
only exclusive claims.

Failures extend `TypedEntityError` and expose stable `code` values. The package contains no SQL or
product identifiers.
