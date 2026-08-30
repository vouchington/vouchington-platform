# @vouchington/worker-runtime

Generic queue selection, [GlideMQ](https://www.npmjs.com/package/glide-mq) worker loading, and
schedule registration. It accepts an application-owned list of worker and schedule definitions;
the package does not name queues, choose deployment topology, or define queue-placement policy.

## Install

```sh
pnpm add @vouchington/worker-runtime glide-mq
```

GlideMQ is a peer dependency so loaded workers share the application's GlideMQ instance.

## Queue selection and workers

`parseQueueSelection` reads a comma-separated `QUEUES` value. A blank value selects every queue;
an all-positive list includes only those names, and an all-negative list excludes those names.
Mixed signs and empty entries are invalid. Includes are strict by default, while callers handling
deployment skew can opt into dropping and observing unknown include names.

```ts
import { loadWorkers, type WorkerDefinition } from '@vouchington/worker-runtime'

const definitions: WorkerDefinition[] = [
  {
    queueName: 'send-email',
    load: () => import('./email-worker.mjs').then((module) => module.worker),
  },
]

const workers = await loadWorkers(definitions, process.env.QUEUES)
```

Definitions marked `requiresExplicitInclusion` run only when an include list names them. Pass
`queueNamesOwnedByOtherRuntimes` when the same `QUEUES` value also selects queues consumed by a
sibling runtime; those names are recognized but never loaded by these definitions.

## Schedules

`upsertSchedules` loads and runs schedules for selected queues. A definition may set `alwaysRun`
when an application intentionally needs it to bypass selection; which schedules may do that is an
application policy, not a package rule.

## Application-owned concerns

This package deliberately does not implement SQS polling, process lifecycle or shutdown,
observability, warmups, worker inventories, or queue placement. Cloudflare routing and CSP also
remain application-owned: they encode each application's routes, origins, authentication, cache,
and security policy.
