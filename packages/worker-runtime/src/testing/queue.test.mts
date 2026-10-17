import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  captureAttachedTestWorkers,
  clampTestWorkerConcurrency,
  getOrCreateQueue,
  getUnexpectedAttachedTestWorkerQueueNames,
  MAX_TEST_WORKER_CONCURRENCY,
  Queue,
  ShimTestQueue,
  UnrecoverableError,
  Worker,
} from './index.mts'

let counter = 0
const workers: Worker[] = []
function name(prefix: string): string {
  counter += 1
  return `q-${prefix}-${counter}`
}
function track<W extends Worker>(worker: W): W {
  workers.push(worker)
  return worker
}

afterEach(async () => {
  await Promise.all(workers.splice(0).map((worker) => worker.close()))
})

describe('ShimTestQueue', () => {
  it('shares one instance per name and exposes the Queue alias', () => {
    const queueName = name('shared')
    const first = new Queue(queueName)
    expect(new ShimTestQueue(queueName)).toBe(first)
    expect(getOrCreateQueue(queueName)).toBe(first)
  })

  it('configures and creates the dead-letter queue by name, also on an existing queue', () => {
    const queueName = name('dlq-config')
    const dead = `${queueName}-dead`
    const plain = new Queue(queueName)
    expect(plain.deadLetterQueueName).toBeUndefined()
    new Queue(queueName, { deadLetterQueue: { name: dead } })
    expect(plain.deadLetterQueueName).toBe(dead)
    expect(getOrCreateQueue(dead).name).toBe(dead)
  })

  it('swallows promote failures when a retrying job cannot be promoted', async () => {
    const queue = new Queue(name('retrying'))
    const promote = vi.fn(() => Promise.reject(new Error('unavailable')))
    queue.emit('retrying', { promote })
    await Promise.resolve()
    expect(promote).toHaveBeenCalledOnce()
  })

  it('close leaves the shared store and workers alive', async () => {
    const queueName = name('close')
    track(new Worker(queueName, () => undefined))
    const queue = new Queue(queueName)
    await queue.close()
    expect(await queue.getWorkers()).toHaveLength(1)
    const job = await queue.add('work', {})
    expect(await job?.getState()).toBe('completed')
  })

  it('addAndWait and replayDeadLetterJob run without nested flushing', async () => {
    const queueName = name('wait')
    const dead = `${queueName}-dead`
    let fail = true
    track(
      new Worker(
        queueName,
        (job: { data: unknown }) => {
          if (fail) throw new UnrecoverableError('dead')
          return job.data
        },
        { deadLetterQueue: { name: dead } },
      ),
    )
    const queue = new Queue(queueName)
    await queue.add('work', { n: 1 }, { expectDeadLetter: true })
    fail = false
    const [envelope] = await queue.getDeadLetterJobs()
    expect(await queue.replayDeadLetterJob(envelope!.id)).toBeDefined()
    expect(await queue.addAndWait('work', { n: 2 }, { waitTimeout: 1_000 } as never)).toEqual({
      n: 2,
    })
  })

  it('obliterate clears jobs, resumes, and cascades to the dead-letter queue once', async () => {
    const queueName = name('obliterate')
    const dead = `${queueName}-dead`
    const queue = new Queue(queueName, { deadLetterQueue: { name: dead } })
    await queue.add('work', {})
    await getOrCreateQueue(dead).add('work', {})
    await queue.pause()
    await queue.obliterate()
    expect(queue.isPaused()).toBe(false)
    expect(await queue.getJobCounts()).toMatchObject({ waiting: 0 })
    expect(await getOrCreateQueue(dead).getJobCounts()).toMatchObject({ waiting: 0 })
    // A cycle between dead-letter queues terminates through the visited set.
    const visited = new Set([queueName])
    await queue.obliterate(undefined, visited)
    expect(visited.size).toBe(1)
  })
})

describe('worker attachment tracking', () => {
  it('reports queue names that gained workers after a baseline', async () => {
    const baselineQueue = name('base')
    const leaked = name('leaked')
    const other = name('other')
    track(new Worker(baselineQueue, () => undefined))
    const baseline = await captureAttachedTestWorkers()
    expect(await getUnexpectedAttachedTestWorkerQueueNames(baseline)).toEqual([])
    const second = track(new Worker(leaked, () => undefined))
    track(new Worker(other, () => undefined))
    track(new Worker(other, () => undefined))
    expect(await getUnexpectedAttachedTestWorkerQueueNames(baseline)).toEqual(
      [leaked, other].toSorted((a, b) => a.localeCompare(b)),
    )
    await second.close()
    expect(await getUnexpectedAttachedTestWorkerQueueNames(baseline)).toEqual([other])
  })
})

describe('Worker', () => {
  it('clamps concurrency to the in-memory cap', () => {
    expect(clampTestWorkerConcurrency()).toBe(MAX_TEST_WORKER_CONCURRENCY)
    expect(clampTestWorkerConcurrency(100)).toBe(MAX_TEST_WORKER_CONCURRENCY)
    expect(clampTestWorkerConcurrency(2)).toBe(2)
    const worker = track(new Worker(name('clamp'), () => undefined, { concurrency: 99 }))
    expect(worker.concurrency).toBe(MAX_TEST_WORKER_CONCURRENCY)
  })

  it('accepts an existing queue and production-only options', async () => {
    const queue = new Queue(name('options'))
    track(
      new Worker(queue, () => 'ok', {
        tokenLimiter: { maxTokens: 10, duration: 1_000, scope: 'ignored' },
        limiter: { max: 5, duration: 1_000 },
        lockDuration: 1_000,
        stalledInterval: 1_000,
      }),
    )
    const job = await queue.add('work', {})
    expect(await job?.getState()).toBe('completed')
  })

  it('forwards the rate limiter', async () => {
    const queueName = name('limiter')
    track(new Worker(queueName, () => 'ok', { limiter: { max: 1, duration: 60_000 } }))
    const queue = new Queue(queueName)
    const first = await queue.add('work', {})
    expect(await first?.getState()).toBe('completed')
    // The window is still full, so the second job is held back and the flush times out.
    await expect(queue.add('work', {}, { flushTimeoutMs: 50 })).rejects.toThrow(
      /Timed out waiting for test queue jobs/,
    )
  })

  it('dispatches batches immediately', async () => {
    const queueName = name('batch')
    const sizes: number[] = []
    track(
      new Worker(
        queueName,
        (jobs: unknown) => {
          sizes.push((jobs as unknown[]).length)
          return Promise.resolve((jobs as unknown[]).map(() => 'ok'))
        },
        { batch: { size: 3, timeout: 10_000 } },
      ),
    )
    const queue = new Queue(queueName)
    await queue.add('work', {})
    expect(sizes).toEqual([1])
  })
})
