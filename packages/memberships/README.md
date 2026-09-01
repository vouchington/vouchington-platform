# @vouchington/memberships

Dependency-free utilities for membership status checks, change classification, SKU grouping, and
benefit catalogs.

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

The status utilities use the vocabulary `active`, `past_due`, `paused`, `cancelled`, and `expired`.
The package does not define state transitions, database tables, products, entitlements,
authorization, payment-provider contracts, webhooks, hosted portals, or refund workflows.
Applications own those concerns along with plans, IDs, money policy, persistence, and side effects.
