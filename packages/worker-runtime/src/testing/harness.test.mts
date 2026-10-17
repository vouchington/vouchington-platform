import { afterEach, describe, expect, it } from 'vitest'

import {
  getOrCreateQueue,
  isInsideTestWorkerProcessor,
  Job,
  Queue,
  TestQueueFlushTimeoutError,
  UnrecoverableError,
  Worker,
} from './index.mts'

let counter = 0
const workers: Worker[] = []
function name(prefix: string): string {
  counter += 1
  return `${prefix}-${counter}`
}
function track<W extends Worker>(worker: W): W {
  workers.push(worker)
  return worker
}

afterEach(async () => {
  await Promise.all(workers.splice(0).map((worker) => worker.close()))
})

describe('add and flush', () => {
  it('resolves once an attached worker completes the job', async () => {
    const queueName = name('done')
    const seen: unknown[] = []
    track(new Worker(queueName, (job: { data: unknown }) => void seen.push(job.data)))
    const job = await new Queue(queueName).add('work', { n: 1 })
    expect(seen).toEqual([{ n: 1 }])
    expect(await job?.getState()).toBe('completed')
    expect(job).toBeInstanceOf(Job)
  })

  it('returns immediately when no worker is attached', async () => {
    const job = await new Queue(name('idle')).add('work', {})
    expect(await job?.getState()).toBe('waiting')
  })

  it('does not wait for delayed jobs', async () => {
    const queueName = name('delayed')
    track(new Worker(queueName, () => undefined))
    const job = await new Queue(queueName).add('work', {}, { delay: 60_000 })
    expect(await job?.getState()).toBe('delayed')
  })

  it('rejects with the processor failure', async () => {
    const queueName = name('fail')
    track(
      new Worker(queueName, () => {
        throw new UnrecoverableError('nope')
      }),
    )
    await expect(new Queue(queueName).add('work', {})).rejects.toThrow(
      /Test queue job failed in ".*" \(work#.*\): nope/,
    )
  })

  it('retries failed jobs until they succeed', async () => {
    const queueName = name('retry')
    let attempts = 0
    track(
      new Worker(queueName, () => {
        attempts += 1
        if (attempts < 2) throw new Error('again')
      }),
    )
    const job = await new Queue(queueName).add(
      'work',
      {},
      { attempts: 3, backoff: { type: 'fixed', delay: 5 } },
    )
    expect(attempts).toBe(2)
    expect(await job?.getState()).toBe('completed')
  })

  it('accepts an expected dead-letter failure once it is admitted', async () => {
    const queueName = name('dlq')
    const dlqName = `${queueName}-dead`
    track(
      new Worker(
        queueName,
        () => {
          throw new UnrecoverableError('dead')
        },
        { deadLetterQueue: { name: dlqName } },
      ),
    )
    const queue = new Queue(queueName)
    const job = await queue.add('work', {}, { expectDeadLetter: true })
    expect(await job?.getState()).toBe('failed')
    expect(await getOrCreateQueue(dlqName).getDeadLetterJobs()).toBeDefined()
    expect((await queue.getDeadLetterJobs()).length).toBe(1)
  })

  it('times out with diagnostics when a processor never settles', async () => {
    const queueName = name('slow')
    track(new Worker(queueName, () => new Promise<void>(() => undefined), { concurrency: 1 }))
    const error = await new Queue(queueName)
      .add('work', {}, { flushTimeoutMs: 30 })
      .catch((err: unknown) => err)
    expect(error).toBeInstanceOf(TestQueueFlushTimeoutError)
    expect((error as TestQueueFlushTimeoutError).message).toContain('1/1')
    expect((error as TestQueueFlushTimeoutError).pendingJobIds).toHaveLength(1)
  })

  it('times out immediately for a zero deadline', async () => {
    const queueName = name('zero')
    track(new Worker(queueName, () => new Promise<void>(() => undefined)))
    await expect(
      new Queue(queueName).add('work', {}, { flushTimeoutMs: 0 }),
    ).rejects.toBeInstanceOf(TestQueueFlushTimeoutError)
  })

  it('does not flush from inside a processor', async () => {
    const queueName = name('nested')
    const inner = name('nested-inner')
    const states: boolean[] = []
    const innerQueue = new Queue(inner)
    track(new Worker(inner, () => new Promise<void>(() => undefined)))
    track(
      new Worker(queueName, async () => {
        states.push(isInsideTestWorkerProcessor())
        await innerQueue.add('child', {}, { flushTimeoutMs: 10 })
        await innerQueue.addBulk([{ name: 'child', data: {}, opts: { flushTimeoutMs: 10 } }])
      }),
    )
    await new Queue(queueName).add('work', {})
    expect(states).toEqual([true])
    expect(isInsideTestWorkerProcessor()).toBe(false)
  })

  it('runs a wrapProcessor hook around the processor', async () => {
    const queueName = name('wrap')
    const calls: string[] = []
    track(
      new Worker(queueName, () => void calls.push('inner'), {
        wrapProcessor: (processor, wrappedQueue) => (job) => {
          calls.push(`before:${wrappedQueue}`)
          return processor(job)
        },
      }),
    )
    await new Queue(queueName).add('work', {})
    expect(calls).toEqual([`before:${queueName}`, 'inner'])
  })
})

describe('addBulk', () => {
  it('flushes every admitted job and applies the longest timeout', async () => {
    const queueName = name('bulk')
    const seen: number[] = []
    track(new Worker(queueName, (job: { data: { n: number } }) => void seen.push(job.data.n)))
    const jobs = await new Queue(queueName).addBulk([
      { name: 'a', data: { n: 1 }, opts: { flushTimeoutMs: 100 } },
      { name: 'b', data: { n: 2 }, opts: { flushTimeoutMs: 2_000 } },
      { name: 'c', data: { n: 3 } },
    ])
    expect(seen.toSorted((a, b) => a - b)).toEqual([1, 2, 3])
    expect(jobs).toHaveLength(3)
  })

  it('skips the flush for an empty bulk and tolerates unadmitted jobs', async () => {
    const queueName = name('bulk-empty')
    track(new Worker(queueName, () => undefined))
    const queue = new Queue(queueName)
    expect(await queue.addBulk([])).toEqual([])
    const [first] = await queue.addBulk([{ name: 'a', data: {}, opts: { jobId: 'dup' } }])
    const second = await queue.addBulk([{ name: 'a', data: {}, opts: { jobId: 'dup' } }])
    expect(first).toBeDefined()
    expect(second).toEqual([])
  })

  it('accepts expected dead-letter failures', async () => {
    const queueName = name('bulk-dlq')
    track(
      new Worker(
        queueName,
        () => {
          throw new UnrecoverableError('dead')
        },
        { deadLetterQueue: { name: `${queueName}-dead` } },
      ),
    )
    const jobs = await new Queue(queueName).addBulk([
      { name: 'a', data: {}, opts: { expectDeadLetter: true } },
      { name: 'b', data: {}, opts: { expectDeadLetter: true } },
    ])
    expect(jobs).toHaveLength(2)
  })
})
