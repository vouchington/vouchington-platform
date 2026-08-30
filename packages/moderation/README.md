# @vouchington/moderation

Configurable report intake, queue-claim expiry helpers, and `@jongleberry/api-server` Context
handler factories.

```ts
import { createReportInputParser, createQueueClaimAdvisor } from '@vouchington/moderation'

const parser = createReportInputParser({
  targetTypes: ['entry', 'account'] as const,
  reasons: ['incorrect', 'unsafe'] as const,
  parseTargetId: (value) => value || null,
  maxNoteLength: 1_000,
})

const draft = parser.parse({
  targetType: 'entry',
  targetId: 'entry-123',
  reason: 'incorrect',
  note: 'Details from the reporter',
})

const claims = createQueueClaimAdvisor<unknown, { id: string }>({
  clock: () => new Date(),
  ttlMs: 15 * 60_000,
  sameActor: (left, right) => left.id === right.id,
})
```

Applications own their target and reason catalogs, identifier validation, cross-field policy,
authentication, authorization, preconditions, persistence, response shape, and routes. The handler
factories only sequence injected callbacks and set conventional 201/200 report-submission, 200
resolution/claim, and 204 release statuses. Queue helpers are advisory; an application's storage
adapter remains responsible for atomic acquisition and release. Queue ownership is compared by the
required `sameActor` callback, so applications define identity for their actor values. Claim and
release timestamps must be valid `Date` instances.
