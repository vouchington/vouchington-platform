# @vouchington/memberships

Dependency-free, schema-less primitives for membership lifecycles, SKU grouping, benefit catalogs,
and payment-provider adapters.

```ts
import {
  buildMembershipBenefitCatalog,
  transitionMembershipLifecycle,
} from '@vouchington/memberships'

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
```

The package fixes only the lifecycle vocabulary: `active`, `past_due`, `paused`, `cancelled`, and
`expired`. It does not define database tables, products, entitlements, authorization, payment
processors, hosted portals, or refund persistence. Applications own their plans, IDs, money policy,
provider-specific adapters, webhook authentication, and access enforcement.

Provider capabilities are structural interfaces. An application supplies its own adapter context and
request/result types for subscription creation, updates, cancellation, webhook normalization,
refundable-payment lookup, and refunds.
