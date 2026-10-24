import { EventEmitter } from 'node:events'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { addSqsConsumerEventListeners, type SqsConsumerEventHooks } from './listeners.mts'
import type { SqsConsumer, SqsMessage } from './types.mts'

const message: SqsMessage = { messageId: 'm1', body: '{}', receiptHandle: 'rh1' }

function setup(overrides: Partial<SqsConsumerEventHooks> = {}) {
  const consumer = Object.assign(new EventEmitter(), { name: 'queue-s' }) as unknown as SqsConsumer
  const hooks: SqsConsumerEventHooks = {
    onError: vi.fn(),
    onEvent: vi.fn(),
    onMessageReceived: vi.fn(),
    onMessageFinished: vi.fn(),
    ...overrides,
  }
  addSqsConsumerEventListeners(consumer, hooks)
  return { consumer, hooks }
}

afterEach(() => vi.restoreAllMocks())

describe('addSqsConsumerEventListeners', () => {
  it('forwards closing and closed', () => {
    const { consumer, hooks } = setup()

    consumer.emit('closing')
    consumer.emit('closed')

    expect(hooks.onEvent).toHaveBeenNthCalledWith(1, 'queue-s', 'closing')
    expect(hooks.onEvent).toHaveBeenNthCalledWith(2, 'queue-s', 'closed')
  })

  it('tags poll errors with the queue and wraps non-Errors', () => {
    const { consumer, hooks } = setup()
    const error = Object.assign(new Error('poll'), { tags: { keep: 'me' } })

    consumer.emit('poll-error', error)
    consumer.emit('poll-error', 'text')

    expect(hooks.onError).toHaveBeenNthCalledWith(1, error)
    expect(error).toHaveProperty('tags', { keep: 'me', queue: 'queue-s' })
    expect(hooks.onError).toHaveBeenNthCalledWith(2, expect.objectContaining({ message: 'text' }))
  })

  it('times completed messages from receipt to deletion', () => {
    const bigint = vi.spyOn(process.hrtime, 'bigint')
    bigint.mockReturnValueOnce(1_000_000n).mockReturnValueOnce(6_000_000n)
    const { consumer, hooks } = setup()

    consumer.emit('message-received', message)
    consumer.emit('message-deleted', message)

    expect(hooks.onMessageReceived).toHaveBeenCalledWith('queue-s', 'm1')
    expect(hooks.onMessageFinished).toHaveBeenCalledWith('queue-s', 'm1', 'completed', 5)
  })

  it('reports failed messages with tags and elapsed time, then forgets the start time', () => {
    const { consumer, hooks } = setup()
    const error = new Error('handler')

    consumer.emit('message-received', message)
    consumer.emit('message-failed', message, error)
    consumer.emit('message-failed', message, error)

    expect(hooks.onMessageFinished).toHaveBeenNthCalledWith(
      1,
      'queue-s',
      'm1',
      'failed',
      expect.any(Number),
    )
    expect(hooks.onMessageFinished).toHaveBeenNthCalledWith(2, 'queue-s', 'm1', 'failed', 0)
    expect(error).toHaveProperty('tags', { queue: 'queue-s', message_id: 'm1' })
    expect(hooks.onError).toHaveBeenCalledWith(error)
  })

  it('reports delete failures without a finished event and clears the start time', () => {
    const { consumer, hooks } = setup()
    const error = new Error('delete')

    consumer.emit('message-received', message)
    consumer.emit('message-delete-failed', message, error)
    consumer.emit('message-deleted', message)

    expect(hooks.onError).toHaveBeenCalledWith(error)
    expect(hooks.onMessageFinished).toHaveBeenCalledTimes(1)
    expect(hooks.onMessageFinished).toHaveBeenCalledWith('queue-s', 'm1', 'completed', 0)
  })

  it('clears timing state even when no completion hook is supplied', () => {
    const bigint = vi.spyOn(process.hrtime, 'bigint').mockReturnValue(BigInt(1))
    const consumer = Object.assign(new EventEmitter(), { name: 's' }) as unknown as SqsConsumer
    addSqsConsumerEventListeners(consumer, { onError: vi.fn() })

    consumer.emit('message-received', message)
    consumer.emit('message-deleted', message)
    consumer.emit('message-received', message)
    consumer.emit('message-failed', message, new Error('x'))

    // One read per receipt plus one per completion, even though no hook consumes the elapsed time.
    expect(bigint).toHaveBeenCalledTimes(4)
  })

  it('tolerates omitted optional hooks and untracked messages', () => {
    const consumer = Object.assign(new EventEmitter(), { name: 's' }) as unknown as SqsConsumer
    addSqsConsumerEventListeners(consumer, { onError: vi.fn() })

    expect(() => {
      consumer.emit('closing')
      consumer.emit('closed')
      consumer.emit('message-received', message)
      consumer.emit('message-deleted', message)
      consumer.emit('message-failed', message, new Error('x'))
    }).not.toThrow()
  })
})
