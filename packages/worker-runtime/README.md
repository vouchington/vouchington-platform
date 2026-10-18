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

## Testing harness (`@vouchington/worker-runtime/testing`)

An in-memory [GlideMQ](https://www.npmjs.com/package/glide-mq) harness for Vitest. It builds on
`glide-mq/testing`, so no Valkey server is needed. Vitest is an optional peer dependency used only
by this subpath; the root export never imports it.

```ts
import { Queue, Worker } from '@vouchington/worker-runtime/testing'

const worker = new Worker('send-email', async (job) => deliver(job.data))
await new Queue('send-email').add('welcome', { to: 'a@example.com' }) // resolves once settled
await worker.close()
```

- `Queue.add` and `addBulk` wait for attached workers to settle the jobs (completed, failed, or
  parked as delayed/suspended). Failures reject with the processor error; a timeout rejects with
  `TestQueueFlushTimeoutError`, which carries worker and queue diagnostics. Per-add options:
  `flushTimeoutMs` and `expectDeadLetter`.
- Adds made from inside a processor never auto-flush.
- `settleRunnableQueueJobs(queue)` waits for all runnable work on one shared test queue before a
  resource snapshot. While any worker is attached, waiting and prioritized jobs remain in scope;
  queues or workers that stay paused or rate-limited therefore time out. It also includes active
  processor callbacks even after record removal, revocation, or worker detachment. Delayed,
  suspended, and waiting-for-children jobs remain parked. The wait is bounded by the same default
  deadline and timeout diagnostics as per-add flush; callers may override the timeout in milliseconds.
- `Worker` accepts the production option shape, clamps concurrency, dispatches batches
  immediately, and takes a `wrapProcessor(processor, queueName)` hook. Subclass it to inject
  profiling or context propagation; the package knows nothing about your application.
- `createWorkerAttachmentGuardRunner(Base?)` returns a Vitest runner class that fails a test file
  which leaves workers attached. Wrap your own runner class, then export the result as the default
  of the module named by `test.runner`:

```ts
// vitest.runner.mts
import { createWorkerAttachmentGuardRunner } from '@vouchington/worker-runtime/testing'

export default createWorkerAttachmentGuardRunner()
```

Queue names, worker modules, and Vitest config wiring remain application-owned.
