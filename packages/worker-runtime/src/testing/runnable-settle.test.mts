import { afterEach, describe, expect, it, vi } from 'vitest'

import { TestQueueFlushTimeoutError } from './flush-diagnostics.mts'
import { FlowProducer, getOrCreateQueue, Worker } from './index.mts'
import { settleRunnableQueueJobs } from './runnable-settle.mts'

const workers: Worker[] = []
const releases: Array<() => void> = []

function queueName(label: string): string {
  return `runnable-settle-${label}-${crypto.randomUUID()}`
}

function heldWorker(name: string) {
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  releases.push(() => release.resolve())
  const worker = new Worker(name, async () => {
    started.resolve()
    await release.promise
  })
  workers.push(worker)
  return { started: started.promise, release: () => release.resolve() }
}

afterEach(async () => {
  for (const release of releases.splice(0)) release()
  await Promise.all(workers.splice(0).map((worker) => worker.close()))
})

describe('settleRunnableQueueJobs', () => {
  it('waits for a held processor and releases its waiter', async () => {
    const name = queueName('active')
    const queue = getOrCreateQueue(name)
    const hold = heldWorker(name)
    const job = await queue.enqueue('work', {})
    await hold.started
    let settled = false
    const waiting = settleRunnableQueueJobs(queue).then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    hold.release()
    await waiting
    expect(await job?.getState()).toBe('completed')
    expect(queue.settleWaiters.size).toBe(0)
  })

  it('keeps waiting after an active record is removed', async () => {
    const name = queueName('removed')
    const queue = getOrCreateQueue(name)
    const hold = heldWorker(name)
    const job = await queue.enqueue('work', {})
    await hold.started
    await job!.remove()
    expect(queue.jobs.has(job!.id)).toBe(false)
    await expect(settleRunnableQueueJobs(queue, 30)).rejects.toBeInstanceOf(
      TestQueueFlushTimeoutError,
    )
    hold.release()
    await settleRunnableQueueJobs(queue)
  })

  it('keeps waiting after active revocation and forced obliteration', async () => {
    const name = queueName('revoked')
    const queue = getOrCreateQueue(name)
    const hold = heldWorker(name)
    const job = await queue.enqueue('work', {})
    await hold.started
    expect(await queue.revoke(job!.id)).toBe('flagged')
    await queue.obliterate()
    await expect(settleRunnableQueueJobs(queue, 30)).rejects.toBeInstanceOf(
      TestQueueFlushTimeoutError,
    )
    hold.release()
    await settleRunnableQueueJobs(queue)
  })

  it('tracks an active processor after its worker detaches', async () => {
    const name = queueName('detached-active')
    const queue = getOrCreateQueue(name)
    const hold = heldWorker(name)
    const job = await queue.enqueue('work', {})
    await hold.started
    await workers[0]!.close()
    await job!.remove()
    expect(queue.workers.size).toBe(0)
    await expect(settleRunnableQueueJobs(queue, 30)).rejects.toBeInstanceOf(
      TestQueueFlushTimeoutError,
    )
    hold.release()
    await settleRunnableQueueJobs(queue)
  })

  it('tracks a new admission with a reused ID while its prior processor runs', async () => {
    const name = queueName('reused')
    const queue = getOrCreateQueue(name)
    const hold = heldWorker(name)
    const first = await queue.enqueue('work', {}, { jobId: 'same' })
    await hold.started
    await first!.remove()
    const second = await queue.enqueue('work', {}, { jobId: 'same', delay: 60_000 })
    expect(await second?.getState()).toBe('delayed')
    await expect(settleRunnableQueueJobs(queue, 30)).rejects.toBeInstanceOf(
      TestQueueFlushTimeoutError,
    )
    hold.release()
    await settleRunnableQueueJobs(queue)
    expect(queue.unsettledJobIds.has('same')).toBe(true)
  })

  it('preserves an admission concurrent with obliteration', async () => {
    const name = queueName('obliterate-admission')
    const queue = getOrCreateQueue(name)
    await queue.pause()
    const hold = heldWorker(name)
    queueMicrotask(() => {
      void queue.enqueue('new-work', {}).catch(() => undefined)
    })
    await queue.obliterate()
    await hold.started
    await expect(settleRunnableQueueJobs(queue, 30)).rejects.toBeInstanceOf(
      TestQueueFlushTimeoutError,
    )
    hold.release()
    await settleRunnableQueueJobs(queue)
  })

  it('does not wait for delayed work', async () => {
    const name = queueName('parked')
    const queue = getOrCreateQueue(name)
    workers.push(new Worker(name, () => undefined))
    const delayed = await queue.enqueue('later', {}, { delay: 60_000 })
    await settleRunnableQueueJobs(queue, 30)
    expect(await delayed?.getState()).toBe('delayed')
  })

  it('does not wait for suspended work', async () => {
    const name = queueName('suspended')
    const queue = getOrCreateQueue(name)
    workers.push(new Worker(name, (job: { suspend: () => Promise<never> }) => job.suspend()))
    const job = await queue.enqueue('pause', {})
    await settleRunnableQueueJobs(queue, 30)
    expect(await job?.getState()).toBe('suspended')
  })

  it('leaves a parent parked while its child waits on another queue', async () => {
    const parentName = queueName('flow-parent')
    const childName = queueName('flow-child')
    const parentQueue = getOrCreateQueue(parentName)
    getOrCreateQueue(childName)
    workers.push(new Worker(parentName, () => undefined))
    const flow = new FlowProducer()
    const tree = await flow.add({
      name: 'parent',
      queueName: parentName,
      data: {},
      children: [{ name: 'child', queueName: childName, data: {} }],
    })
    expect(await tree.job.getState()).toBe('waiting-children')
    await settleRunnableQueueJobs(parentQueue, 30)
    expect(await tree.job.getState()).toBe('waiting-children')
  })

  it('waits for a promoted delayed job until its processor exits', async () => {
    const name = queueName('promoted')
    const queue = getOrCreateQueue(name)
    const hold = heldWorker(name)
    const job = await queue.enqueue('later', {}, { delay: 60_000 })
    await settleRunnableQueueJobs(queue, 30)
    await job!.promote()
    await hold.started
    await expect(settleRunnableQueueJobs(queue, 30)).rejects.toBeInstanceOf(
      TestQueueFlushTimeoutError,
    )
    hold.release()
    await settleRunnableQueueJobs(queue)
  })

  it('keeps a retried job in scope through its next active attempt', async () => {
    const name = queueName('retry')
    const queue = getOrCreateQueue(name)
    const secondStarted = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    releases.push(() => release.resolve())
    let attempts = 0
    workers.push(
      new Worker(name, async () => {
        attempts += 1
        if (attempts === 1) throw new Error('retry')
        secondStarted.resolve()
        await release.promise
      }),
    )
    const job = await queue.enqueue(
      'work',
      {},
      { attempts: 2, backoff: { type: 'fixed', delay: 1 } },
    )
    await secondStarted.promise
    await expect(settleRunnableQueueJobs(queue, 30)).rejects.toBeInstanceOf(
      TestQueueFlushTimeoutError,
    )
    release.resolve()
    await settleRunnableQueueJobs(queue)
    expect(await job?.getState()).toBe('completed')
    expect(attempts).toBe(2)
  })

  it('waits for prioritized work and times out with diagnostics if paused', async () => {
    const name = queueName('prioritized')
    const queue = getOrCreateQueue(name)
    await queue.pause()
    workers.push(new Worker(name, () => undefined))
    const job = await queue.enqueue('ranked', {}, { priority: 1 })
    expect(await job?.getState()).toBe('prioritized')
    const error = await settleRunnableQueueJobs(queue, 30).catch((err: unknown) => err)
    expect(error).toBeInstanceOf(TestQueueFlushTimeoutError)
    expect((error as TestQueueFlushTimeoutError).pendingJobIds).toContain(job!.id)
    expect(queue.settleWaiters.size).toBe(0)
  })

  it('includes waiting work owned by a peer of a paused worker', async () => {
    const name = queueName('peer')
    const queue = getOrCreateQueue(name)
    const paused = new Worker(name, () => undefined)
    workers.push(paused)
    await paused.pause()
    const owner = new Worker(name, () => undefined)
    workers.push(owner)
    await owner.rateLimit(60_000)
    const job = await queue.enqueue('work', {})
    expect(await job?.getState()).toBe('waiting')
    await expect(settleRunnableQueueJobs(queue, 30)).rejects.toBeInstanceOf(
      TestQueueFlushTimeoutError,
    )
  })

  it('returns for orphaned waiting work after the final worker detaches', async () => {
    const name = queueName('detached')
    const queue = getOrCreateQueue(name)
    await queue.pause()
    const worker = new Worker(name, () => undefined)
    workers.push(worker)
    const job = await queue.enqueue('orphan', {})
    const waiting = settleRunnableQueueJobs(queue, 100)
    await worker.close()
    await waiting
    expect(await job?.getState()).toBe('waiting')
  })

  it('skips queues without workers or live callbacks', async () => {
    const queue = getOrCreateQueue(queueName('idle'))
    const job = await queue.enqueue('orphan', {})
    await settleRunnableQueueJobs(queue, 30)
    expect(await job?.getState()).toBe('waiting')
  })

  it('does not enumerate retained terminal jobs', async () => {
    const name = queueName('history')
    const queue = getOrCreateQueue(name)
    workers.push(new Worker(name, () => undefined))
    await queue.add('done', {})
    const enumerate = vi.spyOn(queue.jobs, Symbol.iterator)
    try {
      await settleRunnableQueueJobs(queue)
      expect(enumerate).not.toHaveBeenCalled()
    } finally {
      enumerate.mockRestore()
    }
  })

  it('prunes drained records from the nonterminal index', async () => {
    const queue = getOrCreateQueue(queueName('drain'))
    for (let index = 0; index < 3; index += 1) {
      await queue.enqueue('orphan', { index })
      await queue.drain()
      expect(queue.unsettledJobIds.size).toBe(0)
    }
  })
})
