import { afterEach, describe, expect, it, vi } from 'vitest'

import { setTestWorkerProcessorDecorator } from '../test-processor-decorator.mts'
import {
  createGlideMqRuntime,
  type GlideMqRuntimeConfig,
  type RuntimeWorkerOptions,
} from './runtime.mts'

const created = vi.hoisted(() => ({
  queues: [] as { name: string; options: any; add: ReturnType<typeof vi.fn> }[],
  workers: [] as {
    name: string
    processor: any
    options: any
    close: ReturnType<typeof vi.fn>
    rawClose: ReturnType<typeof vi.fn>
  }[],
  flows: [] as { options: any }[],
}))

vi.mock('glide-mq', () => ({
  Queue: class {
    add = vi.fn(async () => ({ id: 'job' }))
    addBulk = vi.fn(async () => [])
    upsertJobScheduler = vi.fn(async () => undefined)
    constructor(
      public name: string,
      public options: unknown,
    ) {
      created.queues.push(this as never)
    }
  },
  Worker: class {
    close = vi.fn(async () => undefined)
    rawClose = this.close
    constructor(
      public name: string,
      public processor: unknown,
      public options: unknown,
    ) {
      created.workers.push(this as never)
    }
  },
  FlowProducer: class {
    constructor(public options: unknown) {
      created.flows.push(this as never)
    }
  },
}))

const connection = { addresses: [{ host: 'localhost', port: 6379 }] }

function setup(overrides: Partial<GlideMqRuntimeConfig> = {}) {
  const register = vi.fn()
  const unregister = vi.fn()
  const onError = vi.fn()
  const runtime = createGlideMqRuntime({ connection, register, unregister, onError, ...overrides })
  return { runtime, register, unregister, onError }
}

afterEach(() => {
  setTestWorkerProcessorDecorator(undefined)
  created.queues.length = created.workers.length = created.flows.length = 0
})

describe('createGlideMqRuntime queues', () => {
  it('creates registered queues with the shared connection, prefix and client', () => {
    const { runtime, register } = setup({ prefix: 'p', commandClient: 'client' })

    const queue = runtime.createQueue('q', { compression: 'gzip' })

    expect(created.queues[0]?.options).toEqual({
      connection,
      prefix: 'p',
      client: 'client',
      compression: 'gzip',
    })
    expect(register).toHaveBeenCalledWith(queue)
  })

  it('omits unset prefix and client', () => {
    const { runtime } = setup()

    runtime.createQueue('q')

    expect(created.queues[0]?.options).toEqual({ connection })
  })

  it('guards adds on regular queues but never on maintenance queues', async () => {
    const guardAdd = vi.fn(() => 'skip' as const)
    const { runtime, register } = setup({ guardAdd })

    const queue = runtime.createQueue('q')
    const maintenance = runtime.createMaintenanceQueue('q')

    await expect(queue.add('job', {})).resolves.toBeNull()
    await maintenance.add('job', {})
    expect(guardAdd).toHaveBeenCalledTimes(1)
    expect(created.queues[1]?.add).toHaveBeenCalledTimes(1)
    expect(register).toHaveBeenCalledWith(maintenance)
  })

  it('creates registered flow producers', () => {
    const { runtime, register } = setup({ prefix: 'p', commandClient: 'client' })

    const flow = runtime.createFlowProducer()

    expect(created.flows[0]?.options).toEqual({ connection, prefix: 'p', client: 'client' })
    expect(register).toHaveBeenCalledWith(flow)
  })

  it('closes then unregisters, and works without hooks', async () => {
    const { runtime, unregister } = setup()
    const instance = { close: vi.fn(async () => undefined) }

    await runtime.close(instance)

    expect(instance.close).toHaveBeenCalled()
    expect(unregister).toHaveBeenCalledWith(instance)
    const bare = createGlideMqRuntime({ connection, onError: vi.fn() })
    bare.createQueue('q')
    await expect(bare.close(instance)).resolves.toBeUndefined()
  })
})

describe('createGlideMqRuntime workers', () => {
  it('applies stall-count, prefix and command-client defaults', () => {
    const { runtime, register } = setup({ prefix: 'p', commandClient: 'client' })
    const processor = async () => 'ok'

    const worker = runtime.createWorker('q', processor, { concurrency: 3 })

    expect(created.workers[0]?.processor).toBe(processor)
    expect(created.workers[0]?.options).toEqual({
      connection,
      concurrency: 3,
      prefix: 'p',
      maxStalledCount: 2,
      commandClient: 'client',
    })
    expect(register).toHaveBeenCalledWith(worker)
  })

  it('lets callers override prefix and stall counts, and configures the default', () => {
    const { runtime } = setup({ prefix: 'p', defaultMaxStalledCount: 5 })

    runtime.createWorker('a', async () => 1)
    runtime.createWorker('b', async () => 1, { prefix: 'other', maxStalledCount: 9 })

    expect(created.workers[0]?.options).toMatchObject({ prefix: 'p', maxStalledCount: 5 })
    expect(created.workers[1]?.options).toMatchObject({ prefix: 'other', maxStalledCount: 9 })
    expect(created.workers[0]?.options).not.toHaveProperty('commandClient')
  })

  it('omits prefix when neither caller nor config sets one', () => {
    const { runtime } = setup()

    runtime.createWorker('q', async () => 1)

    expect(created.workers[0]?.options).not.toHaveProperty('prefix')
  })

  it('wraps processors with the config wrapper inside the global decorator', () => {
    const order: string[] = []
    const wrapProcessor = vi.fn((processor: any, queue: string) => {
      order.push(`wrap:${queue}`)
      return Object.assign(() => processor(), { wrapped: true })
    })
    const decorator = vi.fn((processor: any, queue: string) => {
      order.push(`decorate:${queue}`)
      return Object.assign(() => processor(), { decorated: true })
    })
    setTestWorkerProcessorDecorator(decorator)
    const { runtime } = setup({ wrapProcessor })

    runtime.createWorker('q', async () => 1)

    expect(order).toEqual(['wrap:q', 'decorate:q'])
    const final = created.workers[0]!.processor as { decorated?: boolean }
    const inner = decorator.mock.calls[0]![0] as { wrapped?: boolean }
    expect(final.decorated).toBe(true)
    expect(inner.wrapped).toBe(true)
  })

  it("passes each worker's exact options to its processor wrapper", () => {
    const wrapProcessor = vi.fn(
      (processor: any, _queue: string, _options: RuntimeWorkerOptions) => processor,
    )
    const { runtime } = setup({ wrapProcessor })
    const options = { concurrency: 3, dedicatedCommandClient: true }
    const processor = async () => 1

    runtime.createWorker('configured', processor, options)
    runtime.createWorker('default', processor)

    expect(wrapProcessor).toHaveBeenNthCalledWith(1, processor, 'configured', options)
    expect(wrapProcessor.mock.calls[0]?.[2]).toBe(options)
    expect(wrapProcessor).toHaveBeenNthCalledWith(2, processor, 'default', {})
  })

  it('does not wrap when neither wrapper nor decorator is set', () => {
    const { runtime } = setup()
    const processor = async () => 1

    runtime.createWorker('q', processor)

    expect(created.workers[0]?.processor).toBe(processor)
  })

  it('decorates batch processors and requires a batch option', () => {
    const decorator = vi.fn((processor: unknown) => processor)
    const wrapBatchProcessor = vi.fn((processor: any) => processor)
    setTestWorkerProcessorDecorator(decorator)
    const { runtime } = setup({ wrapBatchProcessor })

    const options = { batch: { size: 5 } }
    runtime.createBatchWorker('q', async () => [], options)

    expect(created.workers[0]?.options.batch).toEqual({ size: 5 })
    expect(wrapBatchProcessor).toHaveBeenCalledWith(expect.any(Function), 'q', options)
    expect(decorator).toHaveBeenCalledWith(expect.any(Function), 'q')
    expect(() => runtime.createBatchWorker('q', async () => [], {} as never)).toThrow(TypeError)
  })

  it('gives dedicated workers their own client, closed with the worker', async () => {
    const dedicated = { client: 'own', close: vi.fn(async () => undefined) }
    const create = vi.fn(() => dedicated)
    const { runtime } = setup({ commandClient: 'shared', createDedicatedCommandClient: create })

    const worker = runtime.createWorker('q', async () => 1, { dedicatedCommandClient: true })
    const originalClose = created.workers[0]!.rawClose
    await worker.close(true)

    expect(create).toHaveBeenCalledWith('q')
    expect(created.workers[0]?.options.commandClient).toBe('own')
    expect(created.workers[0]?.options).not.toHaveProperty('dedicatedCommandClient')
    expect(originalClose).toHaveBeenCalledWith(true)
    expect(dedicated.close).toHaveBeenCalledTimes(1)
  })

  it('releases the dedicated client when the worker close fails and reports its own failure', async () => {
    const dedicated = {
      client: 'own',
      close: vi.fn(async () => {
        throw new Error('client close failed')
      }),
    }
    const { runtime, onError } = setup({ createDedicatedCommandClient: () => dedicated })
    const worker = runtime.createWorker('q', async () => 1, { dedicatedCommandClient: true })
    created.workers[0]!.rawClose.mockRejectedValueOnce(new Error('worker close failed'))

    await expect(worker.close()).rejects.toThrow('worker close failed')

    expect(dedicated.close).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'client close failed' }),
    )
  })

  it('wraps non-Error close failures', async () => {
    const dedicated = { client: 'own', close: vi.fn(() => Promise.reject('string failure')) }
    const { runtime, onError } = setup({ createDedicatedCommandClient: () => dedicated })
    const worker = runtime.createWorker('q', async () => 1, { dedicatedCommandClient: true })

    await worker.close()

    expect(onError).toHaveBeenCalledWith(new Error('string failure'))
  })

  it('ignores dedicatedCommandClient when no factory is configured', () => {
    const { runtime } = setup({ commandClient: 'shared' })

    runtime.createWorker('q', async () => 1, { dedicatedCommandClient: true })

    expect(created.workers[0]?.options.commandClient).toBe('shared')
  })
})
