# @vouchington/memberships

Dependency-free utilities for membership status checks, change classification, SKU grouping, offer
selection, and benefit catalogs.

```ts
import { buildMembershipBenefitCatalog, classifyMembershipChange } from '@vouchington/memberships'

const catalog = buildMembershipBenefitCatalog(
  {
    version: 1,
    plans: ['basic', 'premium'] as const,
    groups: [
      {
        id: 'usage',
        benefits: [
          {
            id: 'requests',
            placements: ['comparison'] as const,
            values: { basic: 10, premium: 100 },
          },
        ],
      },
    ],
  },
  new Set(['requests'] as const),
)

const change = classifyMembershipChange({
  previousStatus: 'active',
  nextStatus: 'active',
  previousPlan: 'basic',
  nextPlan: 'premium',
  previousSku: 'basic-monthly',
  nextSku: 'premium-monthly',
  comparePlans: (left, right) =>
    ['basic', 'premium'].indexOf(left) - ['basic', 'premium'].indexOf(right),
})
```

Offer selection is callback-driven. Applications define their interval and currency fields, product
identity, and identity ordering. `selectMembershipOffer` filters to the requested interval, uses the
preferred currency when one is available, then chooses the largest supplied identity. It otherwise
falls back to the largest identity in any matching currency. Equal identities keep the first offer.
`groupMembershipOffersByProduct` groups without filtering. `dedupeMembershipOffersByProduct` keeps
the first offer for each canonical product identity by default, or accepts a per-product resolver
that can compose `selectMembershipOffer` and omit unmatched products. Neither utility defines
product, currency, interval, or provider policy.

The status utilities use the vocabulary `active`, `past_due`, `paused`, `cancelled`, and `expired`.
The package does not define state transitions, database tables, products, entitlements,
authorization, payment-provider contracts, webhooks, hosted portals, or refund workflows.
Applications own those concerns along with plans, IDs, money policy, persistence, and side effects.
