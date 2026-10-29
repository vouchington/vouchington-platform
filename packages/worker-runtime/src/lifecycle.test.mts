import type { Worker } from 'glide-mq'
import { describe, expect, it, vi } from 'vitest'

import {
  initializeWorkerRuntime,
  reportWorkerLoadFailure,
  type WorkerRuntimeConfig,
  type WorkerRuntimeDeps,
} from './lifecycle.mts'
import { createQueueClassResolver, WorkerQueueClassError } from './queue-class.mts'

const fakeWorker = (name: string) => ({ name }) as unknown as Worker
const resolver = createQueueClassResolver({ all: ['a', 'b', 's', 'u'], cpu: ['a'] })

function setup(
  configOverrides: Partial<WorkerRuntimeConfig> = {},
  depsOverrides: Partial<WorkerRuntimeDeps<string, { queueName: string }, string>> = {},
  env: { WORKER_QUEUE_CLASS?: string; QUEUES?: string } = {},
) {
  const upsert = vi.fn(async () => undefined)
  const config: WorkerRuntimeConfig = {
    queueClasses: ['all', 'cpu'],
    workerDefinitions: [
      { queueName: 'a', load: async () => fakeWorker('a') },
      { queueName: 'b', load: async () => fakeWorker('b'), requiresExplicitInclusion: true },
    ],
    sqsConsumerDefinitions: [{ queueName: 's' }],
    scheduleDefinitions: [{ queueName: 'a', load: async () => upsert }],
    ...configOverrides,
  }
  const deps: WorkerRuntimeDeps<string, { queueName: string }, string> = {
    loadSqsConsumers: vi.fn(async (definitions: readonly { queueName: string }[]) =>
      definitions.map((d) => `consumer:${d.queueName}`),
    ),
    attachWorker: vi.fn(),
    attachSqsConsumer: vi.fn(),
    onError: vi.fn(),
    env,
    resolveQueueSelection: vi.fn((e, accepted, known) =>
      resolver(e, accepted as ('all' | 'cpu')[], known),
    ),
    ...depsOverrides,
  }
  return { config, deps, upsert }
}

describe('initializeWorkerRuntime loading', () => {
  it('resolves the selection once and shares it with workers, consumers and schedules', async () => {
    const { config, deps, upsert } = setup({}, {}, { WORKER_QUEUE_CLASS: 'cpu' })

    const runtime = await initializeWorkerRuntime(config, deps)
    await runtime.startWorkerRuntime()

    expect(deps.resolveQueueSelection).toHaveBeenCalledTimes(1)
    expect(deps.resolveQueueSelection).toHaveBeenCalledWith(
      { WORKER_QUEUE_CLASS: 'cpu' },
      ['all', 'cpu'],
      ['a', 'b', 's'],
    )
    expect(runtime.workers.map((w) => w.name)).toEqual(['a'])
    expect(deps.loadSqsConsumers).toHaveBeenCalledWith(config.sqsConsumerDefinitions, 'a')
    expect(upsert).toHaveBeenCalledTimes(1)
  })

  it('treats a blank selection as all and does not read process.env.QUEUES', async () => {
    vi.stubEnv('QUEUES', 'a')
    const { config, deps } = setup({}, { resolveQueueSelection: () => undefined })

    const runtime = await initializeWorkerRuntime(config, deps)
    vi.unstubAllEnvs()

    expect(runtime.workers.map((w) => w.name)).toEqual(['a'])
    expect(deps.loadSqsConsumers).toHaveBeenCalledWith(expect.anything(), '')
  })

  it('adds universal workers, which bypass selection but count as known queues', async () => {
    const { config, deps } = setup(
      {},
      {
        loadUniversalWorkers: async () => [fakeWorker('u')],
        universalQueueNames: ['u'],
      },
      { WORKER_QUEUE_CLASS: 'cpu' },
    )

    const runtime = await initializeWorkerRuntime(config, deps)

    expect(deps.resolveQueueSelection).toHaveBeenCalledWith(expect.anything(), expect.anything(), [
      'a',
      'b',
      's',
      'u',
    ])
    expect(runtime.workers.map((w) => w.name)).toEqual(['a', 'u'])
  })

  it('skips the consumer loader when there are no definitions', async () => {
    const { config, deps } = setup({ sqsConsumerDefinitions: [] }, { loadSqsConsumers: undefined })

    const runtime = await initializeWorkerRuntime(config, deps)

    expect(runtime.sqsConsumers).toEqual([])
  })

  it('requires a consumer loader when definitions exist, reporting then throwing', async () => {
    const { config, deps } = setup({}, { loadSqsConsumers: undefined })

    await expect(initializeWorkerRuntime(config, deps)).rejects.toThrow(TypeError)
    expect(deps.onError).toHaveBeenCalledWith(expect.any(TypeError))
  })

  it('runs afterLoad after loading', async () => {
    const afterLoad = vi.fn()
    const { config, deps } = setup({ hooks: { afterLoad } })

    const runtime = await initializeWorkerRuntime(config, deps)

    expect(afterLoad).toHaveBeenCalledTimes(1)
    expect(runtime.sqsConsumers).toEqual(['consumer:s'])
  })

  it.each([
    [
      'conflicting selectors',
      { WORKER_QUEUE_CLASS: 'cpu', QUEUES: 'a' },
      'CONFLICTING_QUEUE_SELECTORS',
    ],
    ['unsupported class', { WORKER_QUEUE_CLASS: 'io' }, 'UNSUPPORTED_QUEUE_CLASS'],
    ['unknown names', { QUEUES: '-nope' }, 'UNKNOWN_QUEUE_NAMES'],
  ])('reports and rethrows %s', async (_label, env, code) => {
    const { config, deps } = setup({}, {}, env)

    const failure = await initializeWorkerRuntime(config, deps).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(WorkerQueueClassError)
    expect((failure as WorkerQueueClassError).code).toBe(code)
    expect(deps.onError).toHaveBeenCalledWith(failure)
  })

  it('reports a worker load failure', async () => {
    const { config, deps } = setup({
      workerDefinitions: [{ queueName: 'a', load: () => Promise.reject(new Error('load failed')) }],
    })

    await expect(initializeWorkerRuntime(config, deps)).rejects.toThrow('load failed')
    expect(deps.onError).toHaveBeenCalledTimes(1)
  })
})

describe('initializeWorkerRuntime cleanup', () => {
  it('closes workers and consumers that loaded when another loader fails', async () => {
    const closeWorker = vi.fn(async () => undefined)
    const closeConsumer = vi.fn(async () => undefined)
    const { config, deps } = setup(
      {
        workerDefinitions: [
          { queueName: 'a', load: async () => ({ close: closeWorker }) as never },
        ],
      },
      {
        loadSqsConsumers: async () => [{ close: closeConsumer }] as never,
        loadUniversalWorkers: async () => {
          throw new Error('universal failed')
        },
      },
    )

    await expect(initializeWorkerRuntime(config, deps)).rejects.toThrow('universal failed')

    expect(closeWorker).toHaveBeenCalledTimes(1)
    expect(closeConsumer).toHaveBeenCalledTimes(1)
    expect(deps.onError).toHaveBeenCalledTimes(1)
  })

  it('closes a loaded worker when a sibling worker loader fails', async () => {
    const closeWorker = vi.fn(async () => undefined)
    const { config, deps } = setup(
      {
        workerDefinitions: [
          { queueName: 'a', load: async () => ({ close: closeWorker }) as never },
          {
            queueName: 'b',
            load: async () => {
              throw new Error('sibling failed')
            },
          },
        ],
        sqsConsumerDefinitions: [],
      },
      {},
      { QUEUES: 'a,b' },
    )

    await expect(initializeWorkerRuntime(config, deps)).rejects.toThrow('sibling failed')

    expect(closeWorker).toHaveBeenCalledTimes(1)
  })

  it('tolerates loaded items without close and failing closers', async () => {
    const { config, deps } = setup(
      {
        workerDefinitions: [
          {
            queueName: 'a',
            load: async () => ({ close: () => Promise.reject(new Error('x')) }) as never,
          },
        ],
      },
      {
        loadSqsConsumers: async () => [{}] as never,
        loadUniversalWorkers: () => Promise.reject(new Error('boom')),
      },
    )

    await expect(initializeWorkerRuntime(config, deps)).rejects.toThrow('boom')
  })
})

describe('startWorkerRuntime', () => {
  it('attaches listeners once across retries', async () => {
    const afterSuccessfulStart = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('hook failed')
      })
      .mockImplementation(() => undefined)
    const { config, deps } = setup({ hooks: { afterSuccessfulStart } })
    const runtime = await initializeWorkerRuntime(config, deps)

    await runtime.startWorkerRuntime().catch(() => undefined)
    await runtime.startWorkerRuntime()

    expect(deps.attachWorker).toHaveBeenCalledTimes(1)
    expect(deps.attachSqsConsumer).toHaveBeenCalledTimes(1)
  })

  it('reports a synchronously throwing setup and still settles schedules', async () => {
    const { config, deps } = setup(
      {},
      {
        setup: () => {
          throw new Error('sync setup failed')
        },
      },
    )
    const runtime = await initializeWorkerRuntime(config, deps)

    await expect(runtime.startWorkerRuntime()).resolves.toBeUndefined()
    expect(deps.onError).toHaveBeenCalledWith(new Error('sync setup failed'))
  })

  it('attaches every worker and consumer, then runs setup', async () => {
    const setupFn = vi.fn(async () => undefined)
    const { config, deps, upsert } = setup({}, { setup: setupFn })
    const runtime = await initializeWorkerRuntime(config, deps)

    await runtime.startWorkerRuntime()

    expect(deps.attachWorker).toHaveBeenCalledWith(runtime.workers[0])
    expect(deps.attachSqsConsumer).toHaveBeenCalledWith('consumer:s')
    expect(upsert).toHaveBeenCalled()
    expect(setupFn).toHaveBeenCalled()
    expect(deps.onError).not.toHaveBeenCalled()
  })

  it('runs afterSuccessfulStart once, only after schedules and setup succeed', async () => {
    const afterSuccessfulStart = vi.fn()
    const { config, deps } = setup({ hooks: { afterSuccessfulStart } })
    const runtime = await initializeWorkerRuntime(config, deps)

    await runtime.startWorkerRuntime()
    await runtime.startWorkerRuntime()

    expect(afterSuccessfulStart).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['schedule', 'schedules'],
    ['setup', 'setup'],
  ])('reports a rejected %s and skips afterSuccessfulStart', async (_label, which) => {
    const afterSuccessfulStart = vi.fn()
    const failure = new Error(`${which} failed`)
    const { config, deps } = setup(
      {
        hooks: { afterSuccessfulStart },
        ...(which === 'schedules'
          ? { scheduleDefinitions: [{ queueName: 'a', load: () => Promise.reject(failure) }] }
          : {}),
      },
      which === 'setup' ? { setup: () => Promise.reject('setup text') } : {},
    )
    const runtime = await initializeWorkerRuntime(config, deps)

    await runtime.startWorkerRuntime()

    expect(deps.onError).toHaveBeenCalledWith(
      which === 'schedules' ? failure : new Error('setup text'),
    )
    expect(afterSuccessfulStart).not.toHaveBeenCalled()
  })

  it('reports and rethrows a throwing afterSuccessfulStart, then allows a retry', async () => {
    const afterSuccessfulStart = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('hook failed')
      })
      .mockImplementation(() => undefined)
    const { config, deps } = setup({ hooks: { afterSuccessfulStart } })
    const runtime = await initializeWorkerRuntime(config, deps)

    await expect(runtime.startWorkerRuntime()).rejects.toThrow('hook failed')
    expect(deps.onError).toHaveBeenCalledWith(new Error('hook failed'))
    await runtime.startWorkerRuntime()

    expect(afterSuccessfulStart).toHaveBeenCalledTimes(2)
  })
})

describe('reportWorkerLoadFailure', () => {
  it('reports then throws, wrapping non-Errors', () => {
    const onError = vi.fn()

    expect(() => reportWorkerLoadFailure('text failure', onError)).toThrow('text failure')
    expect(onError).toHaveBeenCalledWith(new Error('text failure'))
    const failure = new Error('kept')
    expect(() => reportWorkerLoadFailure(failure, onError)).toThrow(failure)
  })
})
