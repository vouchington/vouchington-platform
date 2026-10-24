import { afterEach, describe, expect, it, vi } from 'vitest'

import { onEnqueueAdmission } from './admission.mts'
import {
  createBulkEnqueueFunction,
  createEnqueueFunction,
  ENQUEUE_BASE_DEFAULTS,
} from './enqueue.mts'

const unsubscribes: Array<() => void> = []
afterEach(() => {
  for (const off of unsubscribes.splice(0)) off()
})

function single(overrides: Record<string, unknown> = {}) {
  const queue = { add: vi.fn(async () => ({ id: '1' }) as never) }
  const reportError = vi.fn()
  const enqueue = createEnqueueFunction<{ a: number }, 'job'>({
    queue,
    queueName: 'q',
    jobName: 'job',
    reportError,
    ...overrides,
  })
  return { queue, reportError, enqueue }
}

describe('createEnqueueFunction', () => {
  it('merges base defaults, caller defaults, then per-call options', async () => {
    const { queue, enqueue } = single({ defaults: { attempts: 5, priority: 7 } })

    await enqueue({ a: 1 }, { priority: 1 })

    expect(queue.add).toHaveBeenCalledWith(
      'job',
      { a: 1 },
      {
        ...ENQUEUE_BASE_DEFAULTS,
        attempts: 5,
        priority: 1,
      },
    )
  })

  it('forces removal flags when sensitive', async () => {
    const { queue, enqueue } = single({ sensitive: true })

    await enqueue({ a: 1 })

    expect(queue.add).toHaveBeenCalledWith(
      'job',
      { a: 1 },
      expect.objectContaining({
        removeOnComplete: true,
        removeOnFail: true,
      }),
    )
  })

  it('normalizes the merged options with the job identity', async () => {
    const normalizeOptions = vi.fn((options) => ({ ...options, priority: 99 }))
    const { queue, enqueue } = single({ normalizeOptions })

    await enqueue({ a: 1 })

    expect(normalizeOptions).toHaveBeenCalledWith(expect.objectContaining({ attempts: 3 }), {
      queueName: 'q',
      jobName: 'job',
      data: { a: 1 },
    })
    expect(queue.add).toHaveBeenCalledWith(
      'job',
      { a: 1 },
      expect.objectContaining({ priority: 99 }),
    )
  })

  it('retries through retryFn unless retry is false', async () => {
    const retryFn = vi.fn(<T,>(fn: () => Promise<T>) => fn())
    const retried = single({ retryFn: retryFn as never })
    const unretried = single({ retryFn: retryFn as never, retry: false })

    await retried.enqueue({ a: 1 })
    await unretried.enqueue({ a: 1 })

    expect(retryFn).toHaveBeenCalledTimes(1)
    expect(unretried.queue.add).toHaveBeenCalledTimes(1)
  })

  it('reports a rejected enqueue with decorated context without replacing the promise', async () => {
    const failure = new Error('add failed')
    const queue = { add: vi.fn(() => Promise.reject(failure)) }
    const reportError = vi.fn()
    const decorateError = vi.fn((error: Error) => Object.assign(error, { decorated: true }))
    const enqueue = createEnqueueFunction<string, 'job', { who: string }>({
      queue: queue as never,
      queueName: 'q',
      jobName: 'job',
      reportError,
      decorateError,
    })

    await expect(enqueue('x', undefined, { who: 'caller' })).rejects.toBe(failure)

    expect(decorateError).toHaveBeenCalledWith(failure, {
      queueName: 'q',
      jobName: 'job',
      count: 1,
      callContext: { who: 'caller' },
    })
    expect(reportError).toHaveBeenCalledWith(failure)
  })

  it('reports non-Error rejections and undecorated errors as they are', async () => {
    const queue = { add: vi.fn(() => Promise.reject('text')) }
    const reportError = vi.fn()
    const enqueue = createEnqueueFunction<string, 'job'>({
      queue: queue as never,
      queueName: 'q',
      jobName: 'job',
      reportError,
    })

    await enqueue('x').catch(() => undefined)

    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'text', cause: 'text' }),
    )
  })

  it('does not mutate the shared default backoff when a normalizer edits it', async () => {
    const edited = single({
      normalizeOptions: (options: { backoff?: { delay?: number } }) => {
        options.backoff!.delay = 60_000
        return options
      },
    })
    const untouched = single()

    await edited.enqueue({ a: 1 })
    await untouched.enqueue({ a: 1 })

    expect(ENQUEUE_BASE_DEFAULTS.backoff.delay).toBe(1000)
    expect((untouched.queue.add.mock.calls[0] as unknown[])[2]).toMatchObject({
      backoff: { delay: 1000 },
    })
  })

  it('keeps numeric backoff overrides untouched', async () => {
    const { queue, enqueue } = single({ defaults: { backoff: 5 } })

    await enqueue({ a: 1 })

    expect((queue.add.mock.calls[0] as unknown[])[2]).toMatchObject({ backoff: 5 })
  })

  it('contains failing reporters and decorators for rejected enqueues', async () => {
    const failure = new Error('add failed')
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    const enqueue = createEnqueueFunction<string, 'job'>({
      queue: { add: vi.fn(() => Promise.reject(failure)) } as never,
      queueName: 'q',
      jobName: 'job',
      reportError: () => {
        throw new Error('reporter failed')
      },
      decorateError: () => {
        throw new Error('decorator failed')
      },
    })

    await expect(enqueue('x')).rejects.toBe(failure)
    await new Promise((resolve) => setTimeout(resolve, 10))
    process.off('unhandledRejection', unhandled)

    expect(unhandled).not.toHaveBeenCalled()
  })

  it('contains a failing onEnqueue hook, reporting it and returning the promise', async () => {
    const hookFailure = new Error('metrics failed')
    const { enqueue, reportError } = single({
      onEnqueue: () => {
        throw hookFailure
      },
    })

    await expect(enqueue({ a: 1 })).resolves.toEqual({ id: '1' })
    expect(reportError).toHaveBeenCalledWith(hookFailure)
  })

  it('wraps non-Error onEnqueue failures and survives a failing reporter', async () => {
    const { enqueue } = single({
      onEnqueue: () => {
        throw 'text'
      },
      reportError: () => {
        throw new Error('reporter failed')
      },
    })

    await expect(enqueue({ a: 1 })).resolves.toEqual({ id: '1' })
  })

  it('publishes an admission with the original promise and tracks the enqueue', async () => {
    const onEnqueue = vi.fn()
    const events: Array<{ completion: Promise<unknown>; inputs: readonly unknown[] }> = []
    unsubscribes.push(onEnqueueAdmission((event) => void events.push(event)))
    const { enqueue } = single({ onEnqueue })

    const job = enqueue({ a: 1 })

    expect(events[0]!.completion).toBe(job)
    expect(events[0]!.inputs).toEqual([{ a: 1 }])
    expect(onEnqueue).toHaveBeenCalledWith('q', 'job', 1)
    await job
  })

  it('reports a failing admission observer through reportError without changing the result', async () => {
    unsubscribes.push(
      onEnqueueAdmission(() => {
        throw new Error('observer failed')
      }),
    )
    const { enqueue, reportError } = single()

    await expect(enqueue({ a: 1 })).resolves.toEqual({ id: '1' })
    expect(reportError).toHaveBeenCalledWith(new Error('observer failed'))
  })
})

describe('createBulkEnqueueFunction', () => {
  function bulk(overrides: Record<string, unknown> = {}) {
    const queue = { addBulk: vi.fn(async (jobs: unknown[]) => jobs as never) }
    const reportError = vi.fn()
    const enqueue = createBulkEnqueueFunction({
      queue,
      queueName: 'q',
      jobName: 'job' as const,
      reportError,
      buildJob: (input: number, index: number) => ({
        data: { input, index },
        ...(input === 2 ? { opts: { attempts: 9 } } : {}),
      }),
      ...overrides,
    })
    return { queue, reportError, enqueue }
  }

  it('resolves [] for an empty input without touching the queue or tracking', async () => {
    const onEnqueue = vi.fn()
    const { queue, enqueue } = bulk({ onEnqueue })

    await expect(enqueue([])).resolves.toEqual([])
    expect(queue.addBulk).not.toHaveBeenCalled()
    expect(onEnqueue).not.toHaveBeenCalled()
  })

  it('merges base, defaults, built job options, then per-call options', async () => {
    const { queue, enqueue } = bulk({ defaults: { attempts: 4, priority: 3 } })

    await enqueue([1, 2], { priority: 8 })

    expect(queue.addBulk).toHaveBeenCalledWith([
      {
        name: 'job',
        data: { input: 1, index: 0 },
        opts: { ...ENQUEUE_BASE_DEFAULTS, attempts: 4, priority: 8 },
      },
      {
        name: 'job',
        data: { input: 2, index: 1 },
        opts: { ...ENQUEUE_BASE_DEFAULTS, attempts: 9, priority: 8 },
      },
    ])
  })

  it('normalizes each job, forces sensitive retention, and tracks the count', async () => {
    const normalizeOptions = vi.fn((options: unknown, _job: unknown) => options)
    const onEnqueue = vi.fn()
    const { queue, enqueue } = bulk({ normalizeOptions, sensitive: true, onEnqueue })

    await enqueue([1, 2])

    expect(normalizeOptions).toHaveBeenCalledTimes(2)
    expect(normalizeOptions.mock.calls[0]![1]).toEqual({
      queueName: 'q',
      jobName: 'job',
      data: { input: 1, index: 0 },
    })
    expect(queue.addBulk.mock.calls[0]![0]).toEqual([
      expect.objectContaining({ opts: expect.objectContaining({ removeOnFail: true }) }),
      expect.objectContaining({ opts: expect.objectContaining({ removeOnFail: true }) }),
    ])
    expect(onEnqueue).toHaveBeenCalledWith('q', 'job', 2)
  })

  it('retries unless retry is false', async () => {
    const retryFn = vi.fn(<T,>(fn: () => Promise<T>) => fn())

    await bulk({ retryFn }).enqueue([1])
    await bulk({ retryFn, retry: false }).enqueue([1])

    expect(retryFn).toHaveBeenCalledTimes(1)
  })

  it('lets addBulk replace the queue call, owning its own retry', async () => {
    const retryFn = vi.fn()
    const addBulk = vi.fn(async () => ['custom'] as never)
    const { queue, enqueue } = bulk({ addBulk, retryFn })

    await expect(enqueue([1])).resolves.toEqual(['custom'])
    expect(queue.addBulk).not.toHaveBeenCalled()
    expect(retryFn).not.toHaveBeenCalled()
  })

  it('reports rejections with the job count and publishes admission with all inputs', async () => {
    const failure = new Error('bulk failed')
    const decorateError = vi.fn((error: Error) => error)
    const events: Array<{ inputs: readonly unknown[] }> = []
    unsubscribes.push(onEnqueueAdmission((event) => void events.push(event)))
    const { enqueue, reportError } = bulk({
      queue: { addBulk: vi.fn(() => Promise.reject(failure)) },
      decorateError,
    })

    await expect(enqueue([1, 2])).rejects.toBe(failure)

    expect(decorateError).toHaveBeenCalledWith(failure, expect.objectContaining({ count: 2 }))
    expect(reportError).toHaveBeenCalledWith(failure)
    expect(events[0]!.inputs).toEqual([
      { input: 1, index: 0 },
      { input: 2, index: 1 },
    ])
  })
})
