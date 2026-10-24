import type { Worker } from 'glide-mq'

import type { QueueSelectionEnv } from './queue-class.mts'
import { upsertSchedules, type ScheduleDefinition } from './schedules.mts'
import { loadWorkers, type WorkerDefinition } from './workers.mts'

interface QueueNamed {
  queueName: string
}

export interface WorkerRuntimeHooks {
  afterLoad?: () => void
  afterSuccessfulStart?: () => void
}

export interface WorkerRuntimeConfig<C extends string = string, S extends QueueNamed = QueueNamed> {
  /** The queue classes this entrypoint accepts; any other class fails at startup. */
  queueClasses: readonly C[]
  workerDefinitions: WorkerDefinition[]
  /** Definitions for consumers other than GlideMQ workers; loaded through `loadSqsConsumers`. */
  sqsConsumerDefinitions: S[]
  scheduleDefinitions: ScheduleDefinition[]
  hooks?: WorkerRuntimeHooks
}

export interface WorkerRuntimeDeps<
  C extends string = string,
  S extends QueueNamed = QueueNamed,
  K = unknown,
> {
  /** Loads always-on workers that bypass queue selection. */
  loadUniversalWorkers?: (() => Promise<Worker[]>) | undefined
  /** Names of the universal workers' queues; they count as known queues. */
  universalQueueNames?: readonly string[] | undefined
  /** Loads the selected SQS consumers; required when `sqsConsumerDefinitions` is nonempty. */
  loadSqsConsumers?: ((definitions: readonly S[], queues: string) => Promise<K[]>) | undefined
  attachWorker: (worker: Worker) => void
  attachSqsConsumer: (consumer: K) => void
  setup?: (() => Promise<void>) | undefined
  onError: (error: Error) => void
  env: QueueSelectionEnv
  resolveQueueSelection: (
    env: QueueSelectionEnv,
    acceptedClasses: readonly C[],
    knownQueueNames: readonly string[],
  ) => string | undefined
}

export interface WorkerRuntime<K = unknown> {
  workers: Worker[]
  sqsConsumers: K[]
  startWorkerRuntime: () => Promise<void>
}

const toError = (reason: unknown): Error =>
  reason instanceof Error ? reason : new Error(String(reason))

/** Reports a startup failure through `onError`, then throws it. */
export function reportWorkerLoadFailure(reason: unknown, onError: (error: Error) => void): never {
  const error = toError(reason)
  onError(error)
  throw error
}

/**
 * Loads workers and consumers from one queue selection, resolved once and shared by workers,
 * consumers, and schedules. `startWorkerRuntime` attaches listeners, then registers schedules and
 * runs `setup`; their failures are reported, and `afterSuccessfulStart` runs once, only if both
 * succeeded (a throwing hook is reported, rethrown, and may run again on the next start).
 */
export async function initializeWorkerRuntime<
  C extends string,
  S extends QueueNamed = QueueNamed,
  K = unknown,
>(config: WorkerRuntimeConfig<C, S>, deps: WorkerRuntimeDeps<C, S, K>): Promise<WorkerRuntime<K>> {
  try {
    const knownQueueNames = [
      ...config.workerDefinitions,
      ...config.sqsConsumerDefinitions,
      ...(deps.universalQueueNames ?? []).map((queueName) => ({ queueName })),
    ].map((definition) => definition.queueName)
    // A blank selection means "all"; never fall back to process.env.QUEUES.
    const queues = deps.resolveQueueSelection(deps.env, config.queueClasses, knownQueueNames) ?? ''

    const [workers, sqsConsumers] = await Promise.all([
      Promise.all([
        loadWorkers(config.workerDefinitions, queues),
        deps.loadUniversalWorkers?.() ?? [],
      ]).then(([runtimeWorkers, universalWorkers]) => [...runtimeWorkers, ...universalWorkers]),
      loadConsumers(config, deps, queues),
    ])
    config.hooks?.afterLoad?.()

    let successfulStartHookRan = false
    return {
      workers,
      sqsConsumers,
      async startWorkerRuntime() {
        for (const worker of workers) deps.attachWorker(worker)
        for (const consumer of sqsConsumers) deps.attachSqsConsumer(consumer)

        const results = await Promise.allSettled([
          upsertSchedules(config.scheduleDefinitions, queues),
          deps.setup?.(),
        ])
        for (const result of results) {
          if (result.status === 'rejected') deps.onError(toError(result.reason))
        }

        const afterSuccessfulStart = config.hooks?.afterSuccessfulStart
        const succeeded = results.every((result) => result.status === 'fulfilled')
        if (successfulStartHookRan || !succeeded || !afterSuccessfulStart) return
        successfulStartHookRan = true
        try {
          afterSuccessfulStart()
        } catch (error) {
          successfulStartHookRan = false
          reportWorkerLoadFailure(error, deps.onError)
        }
      },
    }
  } catch (error) {
    reportWorkerLoadFailure(error, deps.onError)
  }
}

async function loadConsumers<C extends string, S extends QueueNamed, K>(
  config: WorkerRuntimeConfig<C, S>,
  deps: WorkerRuntimeDeps<C, S, K>,
  queues: string,
): Promise<K[]> {
  if (config.sqsConsumerDefinitions.length === 0) return []
  if (!deps.loadSqsConsumers) {
    throw new TypeError('loadSqsConsumers is required when sqsConsumerDefinitions are provided')
  }
  return deps.loadSqsConsumers(config.sqsConsumerDefinitions, queues)
}
