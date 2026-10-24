import type { EventEmitter } from 'node:events'

export type SqsMessage = {
  readonly messageId: string
  readonly body: string
  readonly receiptHandle: string
}

export type SqsConsumerHandler = (message: SqsMessage) => Promise<void>

export type SqsConsumerPort = {
  /** Long-polls for messages; must reject when `signal` aborts. */
  receive: (signal: AbortSignal) => Promise<SqsMessage[]>
  delete: (receiptHandle: string) => Promise<void>
}

/**
 * Emits `closing`, `closed`, `poll-error`, `message-received`, `message-failed`,
 * `message-deleted`, and `message-delete-failed`.
 */
export interface SqsConsumer extends EventEmitter {
  readonly name: string
  close: () => Promise<void>
}

export type SqsConsumerDefinition = {
  queueName: string
  /**
   * Returns null when this consumer's own configuration (for example a queue URL) is absent, so
   * loading drops it instead of failing every other consumer. The definition reports the skip.
   */
  load: () => Promise<SqsConsumer | null>
  requiresExplicitInclusion?: boolean
}
