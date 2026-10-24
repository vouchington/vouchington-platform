import {
  FlowProducer,
  Queue,
  Worker,
  type BatchProcessor,
  type ConnectionOptions,
  type Processor,
  type QueueOptions,
  type WorkerOptions,
} from 'glide-mq'

import { guardQueueAdds, type GuardAdd } from './guard-add.mts'
import { closeCommandClientWithWorker, decorateProcessor } from './worker-processors.mts'

export interface DedicatedCommandClient {
  client: unknown
  close(): Promise<void>
}

export interface GlideMqRuntimeConfig {
  connection: ConnectionOptions
  prefix?: string
  /** Shared command client handed to queues, flow producers, and workers. */
  commandClient?: unknown
  /** Builds a per-worker command client for workers created with `dedicatedCommandClient`. */
  createDedicatedCommandClient?: (name: string) => DedicatedCommandClient
  /** Called for every queue, flow producer, and worker created, for shutdown bookkeeping. */
  register?: (instance: object) => void
  unregister?: (instance: object) => void
  /** Receives a failed dedicated command client close. */
  onError: (error: Error) => void
  /** Default `maxStalledCount` for workers. Default 2. */
  defaultMaxStalledCount?: number
  wrapProcessor?: (processor: Processor<any, any>, queueName: string) => Processor<any, any>
  wrapBatchProcessor?: (
    processor: BatchProcessor<any, any>,
    queueName: string,
  ) => BatchProcessor<any, any>
  /** Drops or rewrites options on queue `add`, `addBulk`, and `upsertJobScheduler`. */
  guardAdd?: GuardAdd
}

export type RuntimeQueueOptions = Pick<
  QueueOptions,
  'deadLetterQueue' | 'compression' | 'serializer'
>
export type RuntimeWorkerOptions = Omit<
  WorkerOptions,
  'connection' | 'commandClient' | 'client'
> & {
  /** Gives this worker its own command client, closed when the worker closes. */
  dedicatedCommandClient?: boolean
}

export interface GlideMqRuntime {
  createQueue<T = unknown>(name: string, options?: RuntimeQueueOptions): Queue<T>
  /** A queue handle for maintenance (obliterate, scheduler removal) that never guards adds. */
  createMaintenanceQueue<T = unknown>(name: string): Queue<T>
  createWorker<D = unknown, R = unknown>(
    name: string,
    processor: Processor<D, R>,
    options?: RuntimeWorkerOptions,
  ): Worker<D, R>
  /** A worker whose processor receives up to `batch.size` jobs at once. */
  createBatchWorker<D = unknown, R = unknown>(
    name: string,
    processor: BatchProcessor<D, R>,
    options: RuntimeWorkerOptions & Required<Pick<WorkerOptions, 'batch'>>,
  ): Worker<D, R>
  createFlowProducer(): FlowProducer
  /** Closes the instance, then unregisters it. */
  close(instance: { close(): Promise<void> }): Promise<void>
}

export function createGlideMqRuntime(config: GlideMqRuntimeConfig): GlideMqRuntime {
  const shared = {
    connection: config.connection,
    ...(config.prefix === undefined ? {} : { prefix: config.prefix }),
    ...(config.commandClient === undefined ? {} : { client: config.commandClient as never }),
  }
  const register = (instance: object) => config.register?.(instance)

  function buildWorker<D, R>(
    name: string,
    processor: Processor<D, R> | BatchProcessor<D, R>,
    { dedicatedCommandClient = false, ...options }: RuntimeWorkerOptions,
  ): Worker<D, R> {
    const dedicated =
      dedicatedCommandClient && config.createDedicatedCommandClient
        ? config.createDedicatedCommandClient(name)
        : undefined
    const commandClient = dedicated ? dedicated.client : config.commandClient
    const worker = new Worker<D, R>(name, processor as Processor<D, R>, {
      connection: config.connection,
      ...options,
      ...((options.prefix ?? config.prefix) === undefined
        ? {}
        : { prefix: (options.prefix ?? config.prefix)! }),
      maxStalledCount: options.maxStalledCount ?? config.defaultMaxStalledCount ?? 2,
      ...(commandClient === undefined ? {} : { commandClient: commandClient as never }),
    })
    if (dedicated) closeCommandClientWithWorker(worker, dedicated, config.onError)
    register(worker)
    return worker
  }

  return {
    createQueue(name, options) {
      const queue = new Queue(name, { ...shared, ...options })
      if (config.guardAdd) guardQueueAdds(queue, config.guardAdd)
      register(queue)
      return queue
    },
    createMaintenanceQueue(name) {
      const queue = new Queue(name, shared)
      register(queue)
      return queue
    },
    createWorker(name, processor, options = {}) {
      return buildWorker(name, decorateProcessor(processor, name, config.wrapProcessor), options)
    },
    createBatchWorker(name, processor, options) {
      if (!options?.batch) throw new TypeError('createBatchWorker requires a batch option')
      const wrapped = decorateProcessor(processor, name, config.wrapBatchProcessor)
      return buildWorker(name, wrapped, options)
    },
    createFlowProducer() {
      const flowProducer = new FlowProducer(shared)
      register(flowProducer)
      return flowProducer
    },
    async close(instance) {
      await instance.close()
      config.unregister?.(instance)
    },
  }
}
