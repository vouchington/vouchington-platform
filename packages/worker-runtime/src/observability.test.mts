import { EventEmitter } from 'node:events'

import type { Job, Worker } from 'glide-mq'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { WorkerLogger } from './logger.mts'
import { addWorkerEventListeners, type WorkerObservabilityHooks } from './observability.mts'

const makeWorker = () => Object.assign(new EventEmitter(), { name: 'queue-a' }) as unknown as Worker
const makeJob = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'job-1',
    name: 'send',
    data: { secret: 'x' },
    opts: { attempts: 3 },
    processedOn: 1000,
    finishedOn: 1250,
    ...overrides,
  }) as unknown as Job

function setup(overrides: Partial<WorkerObservabilityHooks> = {}) {
  const worker = makeWorker()
  const hooks: WorkerObservabilityHooks = {
    onError: vi.fn(),
    onWorkerEvent: vi.fn(),
    onJobProgress: vi.fn(),
    onJobCompleted: vi.fn(),
    ...overrides,
  }
  addWorkerEventListeners(worker, hooks)
  return { worker, hooks }
}

afterEach(() => vi.restoreAllMocks())

describe('addWorkerEventListeners', () => {
  it('forwards worker errors and lifecycle events', () => {
    const { worker, hooks } = setup()
    const error = new Error('worker error')

    worker.emit('error', error)
    for (const event of ['drained', 'closed', 'closing', 'ready']) worker.emit(event)

    expect(hooks.onError).toHaveBeenCalledWith(error)
    expect(hooks.onWorkerEvent).toHaveBeenCalledWith('queue-a', 'drained')
    expect(hooks.onWorkerEvent).toHaveBeenCalledWith('queue-a', 'ready')
    expect(hooks.onWorkerEvent).toHaveBeenCalledTimes(4)
  })

  it('forwards job progress events and tolerates missing optional hooks', () => {
    const { worker, hooks } = setup()
    const logger = new WorkerLogger({ enabled: true, write: () => undefined })
    const onActive = vi.spyOn(logger, 'onActive')
    addWorkerEventListeners(worker, { onError: vi.fn(), logger })

    worker.emit('active', makeJob())
    worker.emit('stalled', 'job-9')
    worker.emit('progress', makeJob())

    expect(hooks.onJobProgress).toHaveBeenNthCalledWith(1, 'queue-a', 'send', 'active')
    expect(hooks.onJobProgress).toHaveBeenNthCalledWith(2, 'queue-a', 'job-9', 'stalled')
    expect(hooks.onJobProgress).toHaveBeenNthCalledWith(3, 'queue-a', 'send', 'progress')
    expect(onActive).toHaveBeenCalledWith('queue-a', expect.anything())

    const bare = makeWorker()
    addWorkerEventListeners(bare, { onError: vi.fn() })
    expect(() => {
      for (const event of ['drained', 'stalled', 'progress', 'active', 'completed']) {
        bare.emit(event, makeJob())
      }
    }).not.toThrow()
  })

  it('reports completions with their duration and logs through the logger', () => {
    const lines: string[] = []
    const logger = new WorkerLogger({ enabled: true, level: 'info', write: (l) => lines.push(l) })
    const { worker, hooks } = setup({ logger })

    worker.emit('completed', makeJob())

    expect(hooks.onJobCompleted).toHaveBeenCalledWith('queue-a', 'send', 'completed', 250)
    expect(lines[0]).toContain('queue-a/send')
  })

  it('computes durations from now when timestamps are missing', () => {
    vi.spyOn(Date, 'now').mockReturnValue(5000)
    const { worker, hooks } = setup()

    worker.emit('completed', makeJob({ processedOn: undefined, finishedOn: undefined }))
    worker.emit('completed', makeJob({ processedOn: undefined, finishedOn: 5100 }))

    expect(hooks.onJobCompleted).toHaveBeenNthCalledWith(1, 'queue-a', 'send', 'completed', 0)
    expect(hooks.onJobCompleted).toHaveBeenNthCalledWith(2, 'queue-a', 'send', 'completed', 100)
  })

  it('decorates failed errors with queue and job context, using scrubbed data only', () => {
    const scrubJobData = vi.fn(() => ({ status: 'ok' }))
    const { worker, hooks } = setup({ scrubJobData })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const error = Object.assign(new Error('failed'), {
      tags: { existing: 'tag' },
      extra: { existing: 1 },
    })

    worker.emit('failed', makeJob(), error)

    expect(scrubJobData).toHaveBeenCalledWith({ secret: 'x' })
    expect(error).toMatchObject({
      tags: { existing: 'tag', queue: 'queue-a', job_name: 'send', job_id: 'job-1' },
      extra: { existing: 1, job_name: 'send', attempts: 3, job_data: { status: 'ok' } },
    })
    expect(hooks.onJobCompleted).toHaveBeenCalledWith('queue-a', 'send', 'failed', 250)
    expect(hooks.onError).toHaveBeenCalledWith(error)
  })

  it('attaches no job data without a scrubber, and omits missing id and attempts', () => {
    const { worker, hooks } = setup()
    const error = new Error('failed')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    worker.emit('failed', makeJob({ id: undefined, opts: undefined }), error)

    const decorated = error as Error & { tags: object; extra: object }
    expect(decorated.tags).toEqual({ queue: 'queue-a', job_name: 'send' })
    expect(decorated.extra).toEqual({ job_name: 'send' })
    expect(consoleError).toHaveBeenCalledWith(
      'job failed: %s %o (%dms) %s',
      'send',
      { queue: 'queue-a', job_id: 'unknown' },
      250,
      error.stack,
    )
    expect(hooks.onError).toHaveBeenCalledWith(error)
  })

  it('prints the injected error format and scrubbed data to the console when the logger is off', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const logger = new WorkerLogger({ enabled: false })
    const { worker } = setup({
      logger,
      scrubJobData: () => ({ a: 1 }),
      formatError: () => 'formatted tree',
    })

    worker.emit('failed', makeJob(), new Error('failed'))

    expect(consoleError).toHaveBeenCalledWith(
      'job failed: %s %o (%dms) %s',
      'send',
      { queue: 'queue-a', job_id: 'job-1', job_data: { a: 1 } },
      250,
      'formatted tree',
    )
  })

  it('falls back to the string form when an error has no stack', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { worker } = setup()
    const error = new Error('no stack')
    error.stack = undefined as never

    worker.emit('failed', makeJob(), error)

    expect(consoleError.mock.calls[0]?.[4]).toBe('Error: no stack')
  })

  it('logs through an enabled logger instead of the console', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const lines: string[] = []
    const logger = new WorkerLogger({ enabled: true, write: (l) => lines.push(l) })
    const { worker } = setup({ logger })

    worker.emit('failed', makeJob(), new Error('failed'))

    expect(consoleError).not.toHaveBeenCalled()
    expect(lines[0]).toContain('ERR')
  })

  it('skips console output for expected errors but still tracks and reports them', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { worker, hooks } = setup({ isExpectedError: () => true })

    worker.emit('failed', makeJob(), new Error('expected'))

    expect(consoleError).not.toHaveBeenCalled()
    expect(hooks.onJobCompleted).toHaveBeenCalledWith('queue-a', 'send', 'failed', 250)
    expect(hooks.onError).toHaveBeenCalledTimes(1)
  })

  it('reports a failure that has no job without decoration', () => {
    const { worker, hooks } = setup()
    const error = new Error('no job')

    worker.emit('failed', undefined, error)

    expect(hooks.onError).toHaveBeenCalledWith(error)
    expect(hooks.onJobCompleted).not.toHaveBeenCalled()
    expect(error).not.toHaveProperty('tags')
  })
})
