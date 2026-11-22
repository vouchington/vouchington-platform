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
- `wrapProcessor(processor, queueName, workerOptions)` and
  `wrapBatchProcessor(processor, queueName, workerOptions)` decorate processors before they reach
  the worker. `workerOptions` is the original per-worker options object (or `{}` when omitted),
  before runtime defaults are applied.
- `defaultMaxStalledCount` (default 2) and `prefix` are defaults that callers can override per worker.
- `createDedicatedCommandClient(name)` backs workers created with `dedicatedCommandClient: true`;
  the client closes with the worker, even when the worker close fails, and a failed client close
  goes to `onError`.

`createRetryingCommandClient({ name, connect, retry })` builds a lazily connected proxy: it opens
the real client on the first command, routes every command through the injected `retry` with
`{ command, client }`, and its `close()` is idempotent and safe before connect.

`createEnqueueFunction(options)` and `createBulkEnqueueFunction(options)` build typed enqueue
helpers. Job options merge in the order `ENQUEUE_BASE_DEFAULTS` (3 attempts, exponential 1000 ms
backoff with 0.5 jitter, keep 100 completed and 100 failed), `defaults`, the built job's options
(bulk), then per-call options. `sensitive` forces removal of completed and failed jobs. The
application injects `retryFn` (used unless `retry` is false), `normalizeOptions(options, job)` for
policy such as a priority contract, `onEnqueue(queueName, jobName, count)` for tracking,
`decorateError`, and `reportError`. A rejected enqueue is reported without replacing the returned
promise; an empty bulk input resolves `[]`; a bulk `addBulk` hook replaces the queue call for
fences or recovery. `onEnqueueAdmission(listener)` observes each admission with the original
promise; a throwing listener is recorded in `observerErrors` and reported, and a throwing reporter
in `reportingErrors`, neither affecting the enqueue.

### Scheduler-overlap lease, guarded processors, and stall budget

`createScheduledRunLease({ client, prefix, onError, logger, ... })` returns
`async (queue, job, workerOptions, batch?) => release | null`. Inside a batch wrapper call
`await lease(queue, job, workerOptions, jobs)`: GlideMQ bounds a batch by its longest timeout, so
the lease uses the longest runtime in `jobs`. A job with a `schedulerName` takes a per-scheduler
lease sized from `job.opts.timeout` (or `lockDuration * (maxStalledCount + 1)`) and capped by the
scheduler's interval. A tick that finds a live holder is skipped and counted, and an already
admitted retained job is delayed instead. The decision is one atomic Lua call, so a lost reply
never double-counts or runs a tick known to overlap. Field and metric names
(`admittedField`, `skippedField`, `skippedMetric`, `deferredMetric`) and the log sink are inputs.
The `client` is a small port (`hget`, `get`, `set(key, value, expiryMs)`, `hincrBy`, and
`runScript(lua, keys, args)`), so the package carries no native dependency.

The Lua ships as the strings `ADMIT_SCHEDULED_RUN_LUA` and `RELEASE_SCHEDULED_RUN_LUA`. The
application turns each into a native script once, for example with
`createScriptRegistry((code) => new Script(code))` from `@vouchington/utils/script-registry` (scripts are released on process `exit`), and
`runScript` invokes that script with the given keys and args. The unit tests drive the lease
through a fake client; `scheduled-run-scripts.valkey.test.mts` runs the real Lua against Valkey
when `VALKEY_URL=host:port` is set and skips otherwise, because CI starts no Valkey service.

`createGuardedProcessors({ lease, onError, throwOnSelfAdd })` returns `wrapSingleProcessor` and
`wrapBatchProcessor` (argument order matches the runtime's `wrapProcessor` hooks; they release the
lease after success or failure and resolve `undefined` for a skipped tick). In a batch, a deferred
retained job and a partial `BatchError` keep original positions: the deferred job fails with its
`DelayedError` (GlideMQ's batch path ignores `moveToDelayed`, so the worker retries it through its
normal attempts and backoff) and the rest of the batch still runs, plus
`isActiveProcessorJob(queue, jobId)` and `rejectSelfAdd(queue, jobName, opts)`, which detect a
processor enqueueing the job it is running. Call `rejectSelfAdd` from `guardAdd`.

`withStallBudget(queue, processor, { hget, prefix, maxStalledCount, exempt })` fails a job whose
stored `stalledCount` exceeds the budget (default `DEFAULT_MAX_STALLED_COUNT`, 2) before its
handler runs, so a worker with a high native stall limit does not give ordinary handlers extra
runs. `exempt(job)` names the jobs that keep the native limit.

`acquireTerminalJobRemoval(client, namespace, jobId)` from `@vouchington/utils/terminal-job-removal` WATCHes one job hash on a dedicated
connection and reports `missing`, `live`, or `terminal`; a terminal job exposes `readData()` and
`remove()`, which runs the native `glidemq_removeJob` transaction through the injected
`client.removeJob(keys, args)` and resolves false when a concurrent retry changed the hash.

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
- `clampScheduledJobRepeatToHourlyFloor(repeat)` from `@vouchington/utils/hourly-schedule-clamp` is the core of a `transformRepeat` for low-traffic
  environments (adapt its result: `(repeat) => clampScheduledJobRepeatToHourlyFloor(repeat).repeat`) that must wake at most once an hour: `every` rounds up to a top-of-hour cron
  (`0 * * * *`, an hour-step cron that divides 24, then weekly, then monthly), and a cron keeps
  every field except its minute, which becomes `0`. It returns `{ repeat, clamped }` and rejects a
  malformed minute field. `alignedScheduleText(pattern)` renders an aligned pattern as `every Nh`.

## Worker concurrency

Resolving a worker's concurrency from environment variables is dependency-free and lives in
`@vouchington/utils/worker-concurrency` (`getWorkerConcurrency`, `parseEnvPositiveInt`); pass its
result as the worker's `concurrency` option.

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
`@vouchington/server-utils/error-tree`) controls the printed failure text.

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
