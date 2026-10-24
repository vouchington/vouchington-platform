import type { SqsConsumer, SqsMessage } from './types.mts'

export interface SqsConsumerEventHooks {
  /** Receives the consumer name and `closing` or `closed`. */
  onEvent?: (name: string, event: 'closing' | 'closed') => void
  onMessageReceived?: (name: string, messageId: string) => void
  /** Receives the elapsed milliseconds since receipt (0 when the message was not tracked). */
  onMessageFinished?: (
    name: string,
    messageId: string,
    status: 'completed' | 'failed',
    elapsedMs: number,
  ) => void
  /** Receives poll, handler, and delete errors tagged with the queue and message id. */
  onError: (error: Error) => void
}

type TaggedError = Error & { tags?: Record<string, string | number | boolean> }

/** Wires an SQS consumer's own event vocabulary to injected tracking and error hooks. */
export function addSqsConsumerEventListeners(
  consumer: SqsConsumer,
  hooks: SqsConsumerEventHooks,
): void {
  const { name } = consumer
  const startTimes = new Map<string, bigint>()
  const reportError = (error: unknown, messageId?: string) => {
    const err: TaggedError = error instanceof Error ? error : new Error(String(error))
    err.tags = { ...err.tags, queue: name, ...(messageId != null && { message_id: messageId }) }
    hooks.onError(err)
  }

  consumer.on('closing', () => hooks.onEvent?.(name, 'closing'))
  consumer.on('closed', () => hooks.onEvent?.(name, 'closed'))
  consumer.on('poll-error', (error: unknown) => reportError(error))

  consumer.on('message-received', (message: SqsMessage) => {
    startTimes.set(message.messageId, process.hrtime.bigint())
    hooks.onMessageReceived?.(name, message.messageId)
  })
  consumer.on('message-deleted', (message: SqsMessage) => {
    hooks.onMessageFinished?.(
      name,
      message.messageId,
      'completed',
      takeElapsedMs(startTimes, message),
    )
  })
  consumer.on('message-failed', (message: SqsMessage, error: unknown) => {
    hooks.onMessageFinished?.(name, message.messageId, 'failed', takeElapsedMs(startTimes, message))
    reportError(error, message.messageId)
  })
  // The handler succeeded and only the delete failed: the message is redelivered (and re-handled)
  // once its visibility timeout elapses.
  consumer.on('message-delete-failed', (message: SqsMessage, error: unknown) => {
    takeElapsedMs(startTimes, message)
    reportError(error, message.messageId)
  })
}

function takeElapsedMs(startTimes: Map<string, bigint>, message: SqsMessage): number {
  const startTime = startTimes.get(message.messageId)
  startTimes.delete(message.messageId)
  return startTime === undefined ? 0 : Number(process.hrtime.bigint() - startTime) / 1_000_000
}
