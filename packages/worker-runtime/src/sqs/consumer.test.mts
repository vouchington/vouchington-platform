import { afterEach, describe, expect, it, vi } from 'vitest'

import { createSqsConsumer } from './consumer.mts'
import type { SqsConsumerHandler, SqsConsumerPort, SqsMessage } from './types.mts'

const message = (id: string): SqsMessage => ({
  messageId: id,
  body: '{}',
  receiptHandle: `rh-${id}`,
})

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => (resolve = res))
  return { promise, resolve }
}

// The first receive returns `batch`; later receives hang until aborted, like a real long poll.
function oneShotPort(batch: SqsMessage[], deleted: string[] = []): SqsConsumerPort {
  let calls = 0
  return {
    receive: (signal) =>
      new Promise((resolve, reject) => {
        calls += 1
        if (calls === 1) return resolve(batch)
        signal.addEventListener('abort', () => reject(new Error('AbortError')), { once: true })
      }),
    delete: async (receiptHandle) => void deleted.push(receiptHandle),
  }
}

const once = <T extends unknown[]>(emitter: { once: Function }, event: string) =>
  new Promise<T>((resolve) => emitter.once(event, (...args: T) => resolve(args)))

afterEach(() => vi.useRealTimers())

describe('createSqsConsumer', () => {
  it('handles a message, then deletes it and emits the event sequence', async () => {
    const deleted: string[] = []
    const handleMessage = vi.fn<SqsConsumerHandler>(async () => undefined)
    const consumer = createSqsConsumer({
      name: 'q',
      handleMessage,
      port: oneShotPort([message('1')], deleted),
    })
    const events: string[] = []
    for (const event of ['message-received', 'message-deleted']) {
      consumer.on(event, () => events.push(event))
    }

    await once(consumer, 'message-deleted')
    await consumer.close()

    expect(consumer.name).toBe('q')
    expect(handleMessage).toHaveBeenCalledExactlyOnceWith(message('1'))
    expect(deleted).toEqual(['rh-1'])
    expect(events).toEqual(['message-received', 'message-deleted'])
  })

  it('handles a batch sequentially', async () => {
    const order: string[] = []
    const gate = deferred()
    const handleMessage: SqsConsumerHandler = async (m) => {
      order.push(`start:${m.messageId}`)
      if (m.messageId === '1') await gate.promise
      order.push(`end:${m.messageId}`)
    }
    const consumer = createSqsConsumer({
      name: 'q',
      handleMessage,
      port: oneShotPort([message('1'), message('2')]),
    })

    await vi.waitFor(() => expect(order).toEqual(['start:1']))
    gate.resolve()
    await vi.waitFor(() => expect(order).toEqual(['start:1', 'end:1', 'start:2', 'end:2']))
    await consumer.close()
  })

  it('does not delete a message whose handler failed, and keeps polling', async () => {
    const deleted: string[] = []
    const failure = new Error('boom')
    const consumer = createSqsConsumer({
      name: 'q',
      handleMessage: () => Promise.reject(failure),
      port: oneShotPort([message('1')], deleted),
    })

    const [failed, error] = await once<[SqsMessage, unknown]>(consumer, 'message-failed')
    await consumer.close()

    expect(failed).toEqual(message('1'))
    expect(error).toBe(failure)
    expect(deleted).toEqual([])
  })

  it('emits message-delete-failed when delete rejects', async () => {
    const failure = new Error('delete failed')
    const port = { ...oneShotPort([message('1')]), delete: () => Promise.reject(failure) }
    const deletedListener = vi.fn()
    const consumer = createSqsConsumer({ name: 'q', handleMessage: async () => undefined, port })
    consumer.on('message-deleted', deletedListener)

    const [failed, error] = await once<[SqsMessage, unknown]>(consumer, 'message-delete-failed')
    await consumer.close()

    expect(failed).toEqual(message('1'))
    expect(error).toBe(failure)
    expect(deletedListener).not.toHaveBeenCalled()
  })

  it('survives throwing listeners', async () => {
    const deleted: string[] = []
    const consumer = createSqsConsumer({
      name: 'q',
      handleMessage: async () => undefined,
      port: oneShotPort([message('1')], deleted),
    })
    consumer.on('message-received', () => {
      throw new Error('listener failed')
    })
    consumer.on('message-deleted', () => {
      throw new Error('listener failed')
    })

    await vi.waitFor(() => expect(deleted).toEqual(['rh-1']))
    await expect(consumer.close()).resolves.toBeUndefined()
  })

  it('emits poll-error, backs off, then polls again', async () => {
    vi.useFakeTimers()
    let calls = 0
    const port: SqsConsumerPort = {
      receive: (signal) => {
        calls += 1
        if (calls === 1) return Promise.reject(new Error('network'))
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('AbortError')), { once: true })
        })
      },
      delete: async () => undefined,
    }
    const consumer = createSqsConsumer({
      name: 'q',
      handleMessage: async () => undefined,
      port,
      pollErrorBackoffMs: 1000,
    })
    const pollError = vi.fn()
    consumer.on('poll-error', pollError)

    await vi.advanceTimersByTimeAsync(0)
    expect(pollError).toHaveBeenCalledWith(new Error('network'))
    expect(calls).toBe(1)
    await vi.advanceTimersByTimeAsync(999)
    expect(calls).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(calls).toBe(2)
    await consumer.close()
  })

  it('uses a 5000 ms backoff by default and closes immediately mid-backoff', async () => {
    vi.useFakeTimers()
    let calls = 0
    const port: SqsConsumerPort = {
      receive: () => {
        calls += 1
        return Promise.reject(new Error('network'))
      },
      delete: async () => undefined,
    }
    const consumer = createSqsConsumer({ name: 'q', handleMessage: async () => undefined, port })

    await vi.advanceTimersByTimeAsync(4999)
    expect(calls).toBe(1)
    await consumer.close()
    await vi.advanceTimersByTimeAsync(10_000)

    expect(calls).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('aborts the in-flight receive on close without handling anything', async () => {
    let aborted = false
    const port: SqsConsumerPort = {
      receive: (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            aborted = true
            reject(new Error('AbortError'))
          })
        }),
      delete: async () => undefined,
    }
    const handleMessage = vi.fn<SqsConsumerHandler>()
    const consumer = createSqsConsumer({ name: 'q', handleMessage, port })

    await consumer.close()

    expect(aborted).toBe(true)
    expect(handleMessage).not.toHaveBeenCalled()
  })

  it('waits for the batch in progress on close, then deletes the message', async () => {
    const deleted: string[] = []
    const started = deferred()
    const release = deferred()
    const handleMessage: SqsConsumerHandler = async () => {
      started.resolve()
      await release.promise
    }
    const consumer = createSqsConsumer({
      name: 'q',
      handleMessage,
      port: oneShotPort([message('1')], deleted),
    })

    await started.promise
    const closing = consumer.close()
    expect(deleted).toEqual([])
    release.resolve()
    await closing

    expect(deleted).toEqual(['rh-1'])
  })

  it('closes idempotently, emitting closing then closed once', async () => {
    const consumer = createSqsConsumer({
      name: 'q',
      handleMessage: async () => undefined,
      port: oneShotPort([]),
    })
    const events: string[] = []
    consumer.on('closing', () => events.push('closing'))
    consumer.on('closed', () => events.push('closed'))

    await Promise.all([consumer.close(), consumer.close()])
    await consumer.close()

    expect(events).toEqual(['closing', 'closed'])
  })
})
