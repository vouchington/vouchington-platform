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

## GlideMQ runtime (`@vouchington/worker-runtime/glide-mq`)

`createGlideMqRuntime(config)` returns `createQueue`, `createMaintenanceQueue`, `createWorker`,
`createBatchWorker`, `createFlowProducer`, and `close(instance)`, all sharing an injected
`connection`, optional `prefix`, and optional shared `commandClient`. The application supplies the
rest through hooks:

- `register` / `unregister` track every queue, flow producer, and worker for shutdown.
- `guardAdd({ queueName, jobName, opts })` runs on `add`, `addBulk`, and `upsertJobScheduler` and
  returns `'skip'` or `{ opts }`. Maintenance queues never guard, so they can never add jobs.
- `wrapProcessor` / `wrapBatchProcessor` decorate processors before they reach the worker.
- `defaultMaxStalledCount` (default 2) and `prefix` are defaults that callers can override per worker.
- `createDedicatedCommandClient(name)` backs workers created with `dedicatedCommandClient: true`;
  the client closes with the worker, even when the worker close fails, and a failed client close
  goes to `onError`.

`createRetryingCommandClient({ name, connect, retry })` builds a lazily connected proxy: it opens
the real client on the first command, routes every command through the injected `retry` with
`{ command, client }`, and its `close()` is idempotent and safe before connect.

`getQueueStats(queue, name)`, `getAllQueueStats(queues)` (sorted by name), and
`aggregateQueueStats(stats)` read job counts and paused state from plain GlideMQ queues.

## SQS consumers (`@vouchington/worker-runtime/sqs`)

`createSqsConsumer({ name, handleMessage, port, pollErrorBackoffMs })` runs a sequential long-poll
loop over an injected port (`receive(signal)` and `delete(receiptHandle)`). A message is deleted
only after its handler succeeds; a failed handler leaves it undeleted, so the visibility timeout
redelivers it. Events: `closing`, `closed`, `poll-error`, `message-received`, `message-failed`,
`message-deleted`, and `message-delete-failed`. A throwing listener does not stop the loop, a
failed receive backs off (default 5000 ms, cut short by `close()`), and `close()` is idempotent,
aborts the in-flight receive, and waits for the batch in progress.

`createSqsClientPort(client, queueUrl, { maxMessages, waitTimeSeconds })` adapts any client with
`send` (an SQS client). `@aws-sdk/client-sqs` is an optional peer, loaded on first use, so the rest
of the subpath works without it. Messages missing an id, receipt handle, or body are dropped.
`selectedSqsConsumerDefinitions` and `loadSqsConsumers` apply the process's queue selection
(honoring `requiresExplicitInclusion` and ignoring other runtimes' names) and drop definitions
whose `load()` returns `null`; pass `loadSqsConsumers` to `initializeWorkerRuntime`.
`addSqsConsumerEventListeners(consumer, hooks)` maps the events to `onEvent`, `onMessageReceived`,
`onMessageFinished` (with elapsed time), and `onError` (tagged with the queue and message id).

## Scheduled-job manifests (`@vouchington/worker-runtime/schedule-manifest`)

A manifest lists scheduled jobs for one queue: `schedulerId`, a `repeat` (`{ pattern }` with a
5-field cron, or `{ every }` in milliseconds, optionally a thunk), a `template` (`name`, `opts`,
and `data` or `dataFactory`), an optional `registration: 'sequential'`, a nonempty list of opaque
`operatorSurfaces`, and an optional `subMinuteJustification`.

- `defineScheduledJobManifest(queueName, jobs, { validateSurface })` and
  `validateScheduledJobManifests(manifests, { validateSurface })` check names, unique scheduler
  keys, `data` xor `dataFactory`, and non-thunk repeats. The operator-surface type is the
  application's; `validateSurface(surface, schedulerKey)` is where it rejects bad surfaces.
- `validateScheduledJobRepeat(repeat, key, justification?)` enforces exactly one of `pattern` and
  `every`, a 5-field cron, a positive finite `every`, and the 60 000 ms floor
  (`SCHEDULING_FLOOR_MS`) unless justified. Thunk repeats are validated when resolved.
- `upsertScheduledJobManifest(queue, manifest, { include, transformRepeat })` registers jobs
  (sequential jobs alone and in order, others in parallel batches), then removes schedulers on the
  queue that are no longer in the manifest. `include` replaces an environment filter and
  `transformRepeat` replaces a cadence clamp; both are application policy.
- `removeScheduledJobScheduler(queue, id)` reports the scheduler names before and after.
- `toSchedulerTemplateOptions(opts)` drops `delay`, `deduplication`, `parent`, and `jobId`.

## Lifecycle, serve, and queue classes

`initializeWorkerRuntime(config, deps)` resolves one queue selection through the injected
`resolveQueueSelection` and shares it with workers, other consumers, and schedules. Universal
workers (`loadUniversalWorkers`) bypass selection but their `universalQueueNames` count as known
queues. `afterLoad` runs after loading. `startWorkerRuntime()` attaches listeners through
`attachWorker` / `attachSqsConsumer`, then registers schedules and runs `setup`; rejections are
reported through `onError`, and `afterSuccessfulStart` runs once, only if both succeeded (if it
throws, the failure is reported, rethrown, and the once-flag resets). Consumers other than GlideMQ
workers load through the injected `loadSqsConsumers`. `reportWorkerLoadFailure(reason, onError)`
reports, then throws.

`createQueueClassResolver(policy)` maps `WORKER_QUEUE_CLASS` to an explicit include list from a
policy of `class name -> queue names`; the class names are the application's. Setting both
`WORKER_QUEUE_CLASS` and `QUEUES`, an unaccepted class, or an unknown `QUEUES` name (including
`-name` excludes) throws `WorkerQueueClassError` with code `CONFLICTING_QUEUE_SELECTORS`,
`UNSUPPORTED_QUEUE_CLASS`, or `UNKNOWN_QUEUE_NAMES`. Blank values count as unset.
`validateQueuePolicy(raw, groups, { containedIn })` checks a policy object for exact fields,
unique canonical names, no overlap, and subset groups.

`registerWorkerServe(deps)` installs crash reporting (`uncaughtException` reports then exits 1 after
an error flush or a 2100 ms timer; `unhandledRejection` reports only), an optional prewarm server
(only when `NODE_PREWARM` and `NODE_PREWARM_PORT` are both set), and a shutdown callback that
closes the prewarm server and every worker. Process, console, timers, and the server factory are
injected.

## Observability and logging

`addWorkerEventListeners(worker, hooks)` wires a GlideMQ worker's events to injected hooks:
`onError`, `onWorkerEvent` (`drained`, `closed`, `closing`, `ready`), `onJobProgress` (`active`,
`stalled`, `progress`), and `onJobCompleted` with the duration. Failed jobs are decorated with
`tags` (`queue`, `job_name`, `job_id`) and `extra` (`job_name`, `attempts`, and `job_data`) before
`onError` runs. Job data is attached only when a `scrubJobData` hook is supplied (for example
`@vouchington/utils/job-data-scrub`), so raw payloads never reach error context by default.
`isExpectedError` suppresses console output for expected failures, and `formatError` (for example
`@vouchington/utils/error-tree`) controls the printed failure text.

`WorkerLogger` is a dev-only one-line-per-job logger with timing colors. `enabled` is a required
injected boolean; `level` (`'error'` or `'info'`), timing thresholds, and the `write` sink are
options. Failures and completions go through it when it is enabled.

## Application-owned concerns

This package deliberately does not implement warmups, worker
inventories, or queue placement. Cloudflare routing and CSP also remain application-owned: they
encode each application's routes, origins, authentication, cache, and security policy.

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
- `setTestWorkerProcessorDecorator(decorator)` and `getTestWorkerProcessorDecorator()` manage a
  global processor decorator, keyed by
  `Symbol.for('@vouchington/worker-runtime.testWorkerProcessorDecorator')` so it survives
  `vi.resetModules()`. When one is set, the GlideMQ runtime wraps every single and batch processor
  with `decorator(processor, queueName)`, outside any config-level wrapper. The slot module imports
  neither Vitest nor `glide-mq/testing`; decorators themselves (for example query profilers) stay
  in the application.
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
