import { describe, expect, it, vi } from 'vitest'

import { createSqsClientPort } from './port.mts'

describe('createSqsClientPort', () => {
  it('receives with defaults, passes the abort signal, and drops incomplete messages', async () => {
    const send = vi.fn(async () => ({
      Messages: [
        { MessageId: '1', ReceiptHandle: 'rh1', Body: 'one' },
        { MessageId: '2', ReceiptHandle: 'rh2', Body: '' },
        { MessageId: '', ReceiptHandle: 'rh3', Body: 'x' },
        { MessageId: '4', Body: 'x' },
        { MessageId: '5', ReceiptHandle: 'rh5', Body: null },
      ],
    }))
    const controller = new AbortController()

    const messages = await createSqsClientPort({ send }, 'https://queue.test/q').receive(
      controller.signal,
    )

    expect(messages).toEqual([
      { messageId: '1', body: 'one', receiptHandle: 'rh1' },
      { messageId: '2', body: '', receiptHandle: 'rh2' },
    ])
    const [command, options] = send.mock.calls[0] as unknown as [{ input: unknown }, unknown]
    expect(command.input).toEqual({
      QueueUrl: 'https://queue.test/q',
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 20,
    })
    expect(options).toEqual({ abortSignal: controller.signal })
  })

  it('honors receive options and tolerates an empty response', async () => {
    const send = vi.fn(async () => ({}))
    const port = createSqsClientPort({ send }, 'u', { maxMessages: 3, waitTimeSeconds: 5 })

    await expect(port.receive(new AbortController().signal)).resolves.toEqual([])

    const [command] = send.mock.calls[0] as unknown as [{ input: unknown }]
    expect(command.input).toMatchObject({ MaxNumberOfMessages: 3, WaitTimeSeconds: 5 })
  })

  it('deletes by receipt handle', async () => {
    const send = vi.fn(async () => ({}))

    await createSqsClientPort({ send }, 'u').delete('rh1')

    const [command] = send.mock.calls[0] as unknown as [{ input: unknown }]
    expect(command.input).toEqual({ QueueUrl: 'u', ReceiptHandle: 'rh1' })
  })
})
