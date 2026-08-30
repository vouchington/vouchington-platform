# @vouchington/reviews

Schema-less review lifecycle and rating orchestration. Applications own their review records,
target tables, authorization, transactions, route paths, request codecs, response mapping, and
side effects.

```ts
import { createReviewsEngine } from '@vouchington/reviews'

const reviews = createReviewsEngine({
  repository,
  reviews: reviewRepository,
  authorize,
  onPostCommit,
  policy: {
    targetTypes: ['provider', 'model', 'series'],
    isTargetEligible,
    rating: { minimum: 1, maximum: 5 },
    count: { minimum: 1, maximum: 3 },
    comparison: (ratings) =>
      new Set(ratings.map((rating) => rating.rating)).size === ratings.length,
    canDelete: ({ ratings }) => ratings.length > 1,
  },
})
```

`createReview` accepts an application-defined review payload plus its initial ratings. It creates
the review and ratings within the supplied transaction, locks the resulting review key, then
validates the complete persisted rating set before commit. `addRating`, `updateRating`, and
`deleteRating` likewise require `repository.lockReview` before mutation and final-state reads.
The lock reports missing reviews consistently, and transaction-scoped authorization and target
eligibility hooks can use the same connection. Lifecycle updates are locked and the persisted
rating set is revalidated, so application-defined update payloads cannot bypass rating policy.
The engine calls `onPostCommit` only after the repository transaction resolves; transaction safety
is guaranteed by the injected repository implementation.

All rules are explicit. The package has no built-in target types, rating scale, rating count,
comparison rule, deletion rule, auth policy, table name, UUID assumption, or ordering uniqueness
rule. Target IDs are opaque non-empty strings and rating CRUD is individual, never a bulk replace.

`registerReviewRoutes` optionally mounts lifecycle and/or individual rating endpoints on an
`@jongleberry/api-server`-compatible registrar. The application supplies paths, codecs, response
mapping, and error mapping, so it can mount only the endpoints it needs.
An error mapper must complete the response or throw; returning means the error was handled.

## Provenance

Generalized from Filaments `d9c77a857848387df3c9c62e4821ee4e5044aa0c`:
`backend/services/posts/post-ratings.mts`,
`backend/services/posts/post-ratings/delete.mts`,
`backend/services/posts/validate-review-topic-ratings.mts`, and
`backend/api/v1/posts/post-ratings.mts`, with their review-create and rating-management tests.
