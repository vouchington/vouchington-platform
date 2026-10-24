import type { SqsConsumerPort, SqsMessage } from './types.mts'

export type SqsSendClient = {
  send: (command: any, options?: { abortSignal?: AbortSignal }) => Promise<any>
}

export type SqsClientPortOptions = {
  /** Messages per receive. Default 10. */
  maxMessages?: number
  /** Long-poll wait in seconds. Default 20. */
  waitTimeSeconds?: number
}

/**
 * A consumer port over any client with `send` (an SQS client). `@aws-sdk/client-sqs` is an
 * optional peer, loaded on first use so the rest of this subpath works without it. Messages missing
 * an id, receipt handle, or body are dropped, and the abort signal reaches the receive call.
 */
export function createSqsClientPort(
  client: SqsSendClient,
  queueUrl: string,
  { maxMessages = 10, waitTimeSeconds = 20 }: SqsClientPortOptions = {},
): SqsConsumerPort {
  return {
    async receive(signal) {
      const { ReceiveMessageCommand } = await import('@aws-sdk/client-sqs')
      const result = await client.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: maxMessages,
          WaitTimeSeconds: waitTimeSeconds,
        }),
        { abortSignal: signal },
      )
      return ((result.Messages ?? []) as RawMessage[]).flatMap(toSqsMessage)
    },
    async delete(receiptHandle) {
      const { DeleteMessageCommand } = await import('@aws-sdk/client-sqs')
      await client.send(
        new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receiptHandle }),
      )
    },
  }
}

type RawMessage = { MessageId?: string; ReceiptHandle?: string; Body?: string | null }

function toSqsMessage(message: RawMessage): SqsMessage[] {
  if (!message.MessageId || !message.ReceiptHandle || message.Body == null) return []
  return [
    { messageId: message.MessageId, body: message.Body, receiptHandle: message.ReceiptHandle },
  ]
}
