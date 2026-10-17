import { describe, expect, it } from 'vitest'
import {
  SQS_CLIENT_CONFIG,
  buildDeleteMessageBatchCommand,
  buildReceiveMessageCommand,
  buildSendMessageBatchCommand,
  chunkDeleteEntries,
  chunkSendEntries,
  classifyBatchFailures,
  decodeMessageAttributes,
  encodeMessageAttributes,
} from './sqs.mts'

describe('sqs', () => {
  it('disables queue-url endpoints and enables dual-stack', () => {
    expect(SQS_CLIENT_CONFIG).toEqual({ useDualstackEndpoint: true, useQueueUrlAsEndpoint: false })
  })

  it('round-trips message attributes', () => {
    const bytes = new Uint8Array([1, 2])
    const encoded = encodeMessageAttributes({ s: 'x', n: 4, b: bytes })
    expect(encoded).toEqual({
      s: { DataType: 'String', StringValue: 'x' },
      n: { DataType: 'Number', StringValue: '4' },
      b: { DataType: 'Binary', BinaryValue: bytes },
    })
    expect(decodeMessageAttributes(encoded)).toEqual({ s: 'x', n: '4', b: bytes })
  })

  it('decodes custom types and tolerates missing or empty values', () => {
    expect(decodeMessageAttributes(undefined)).toEqual({})
    expect(
      decodeMessageAttributes({
        a: { DataType: 'String.custom', StringValue: 'v' },
        b: { DataType: 'Number.int', StringValue: '2' },
        c: { DataType: 'Binary' },
        d: { DataType: 'String' },
        e: {} as never,
      }),
    ).toEqual({ a: 'v', b: '2' })
  })

  it('chunks send entries by count and bytes', () => {
    const entries = Array.from({ length: 12 }, (_, i) => ({ Id: `${i}`, MessageBody: 'x' }))
    expect(chunkSendEntries(entries).map((chunk) => chunk.length)).toEqual([10, 2])
    const big = 'x'.repeat(600_000)
    expect(
      chunkSendEntries([
        { Id: '1', MessageBody: big },
        { Id: '2', MessageBody: big },
      ]),
    ).toHaveLength(2)
  })

  it('counts attribute bytes and rejects oversized entries', () => {
    const entry = {
      Id: '1',
      MessageBody: 'x'.repeat(1_048_500),
      MessageAttributes: { a: { DataType: 'String', StringValue: 'y'.repeat(200) } },
    }
    expect(() => chunkSendEntries([entry])).toThrow(RangeError)
    expect(() =>
      chunkSendEntries([
        {
          Id: '1',
          MessageAttributes: { a: { DataType: 'Binary', BinaryValue: new Uint8Array(1_048_576) } },
          MessageBody: 'x',
        },
      ]),
    ).toThrow(RangeError)
    expect(chunkSendEntries([{ Id: '1', MessageAttributes: { a: {} } } as never])).toHaveLength(1)
  })

  it('chunks delete entries by count', () => {
    const entries = Array.from({ length: 11 }, (_, i) => ({ Id: `${i}`, ReceiptHandle: 'h' }))
    expect(chunkDeleteEntries(entries).map((chunk) => chunk.length)).toEqual([10, 1])
  })

  it('builds commands', () => {
    const entries = [{ Id: '1', MessageBody: 'b' }]
    expect(buildSendMessageBatchCommand('q', entries).input).toEqual({
      QueueUrl: 'q',
      Entries: entries,
    })
    expect(
      buildDeleteMessageBatchCommand('q', [{ Id: '1', ReceiptHandle: 'h' }]).input.QueueUrl,
    ).toBe('q')
    expect(buildReceiveMessageCommand('q').input).toEqual({
      QueueUrl: 'q',
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 20,
      MessageAttributeNames: ['All'],
    })
    expect(
      buildReceiveMessageCommand('q', {
        maxMessages: 1,
        waitTimeSeconds: 0,
        visibilityTimeoutSeconds: 30,
      }).input,
    ).toMatchObject({ MaxNumberOfMessages: 1, WaitTimeSeconds: 0, VisibilityTimeout: 30 })
  })

  it('classifies batch failures', () => {
    const sender = { Id: '1', SenderFault: true, Code: 'x' }
    const server = { Id: '2', SenderFault: false, Code: 'y' }
    expect(classifyBatchFailures([sender, server])).toEqual({
      senderFault: [sender],
      retryable: [server],
    })
    expect(classifyBatchFailures(undefined)).toEqual({ senderFault: [], retryable: [] })
  })
})
