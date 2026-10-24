import { EventEmitter } from 'node:events'

import type { SqsConsumer, SqsConsumerHandler, SqsConsumerPort, SqsMessage } from './types.mts'

export type CreateSqsConsumerOptions = {
  name: string
  handleMessage: SqsConsumerHandler
  port: SqsConsumerPort
  /** Pause after a failed receive, so persistent errors do not spin. Default 5000. */
  pollErrorBackoffMs?: number
}

class SqsConsumerImpl extends EventEmitter implements SqsConsumer {
  readonly name: string
  readonly #abortController = new AbortController()
  readonly #loop: Promise<void>
  readonly #backoffMs: number
  #closing: Promise<void> | null = null

  constructor(options: CreateSqsConsumerOptions) {
    super()
    this.name = options.name
    this.#backoffMs = options.pollErrorBackoffMs ?? 5000
    this.#loop = this.#poll(options.port, options.handleMessage)
  }

  /** Every caller gets the same promise, so each one waits for the batch in progress. */
  close(): Promise<void> {
    this.#closing ??= this.#shutdown()
    return this.#closing
  }

  async #shutdown(): Promise<void> {
    this.#emitSafely('closing')
    // Abort the in-flight (or next) long poll so shutdown does not wait out an idle receive.
    // Messages already pulled from a prior batch finish handling; an unfinished handler leaves its
    // message undeleted, and the visibility timeout redelivers it.
    this.#abortController.abort()
    await this.#loop
    this.#emitSafely('closed')
  }

  async #poll(port: SqsConsumerPort, handleMessage: SqsConsumerHandler): Promise<void> {
    const { signal } = this.#abortController
    while (!signal.aborted) {
      let messages: SqsMessage[]
      try {
        // oxlint-disable-next-line no-await-in-loop -- long polling is inherently sequential
        messages = await port.receive(signal)
      } catch (error) {
        if (signal.aborted) break
        this.#emitSafely('poll-error', error)
        // oxlint-disable-next-line no-await-in-loop
        await waitForBackoff(signal, this.#backoffMs)
        continue
      }
      for (const message of messages) {
        // oxlint-disable-next-line no-await-in-loop -- one batch is handled sequentially
        await this.#handle(message, port, handleMessage)
      }
    }
  }

  async #handle(
    message: SqsMessage,
    port: SqsConsumerPort,
    handleMessage: SqsConsumerHandler,
  ): Promise<void> {
    this.#emitSafely('message-received', message)
    try {
      await handleMessage(message)
    } catch (error) {
      this.#emitSafely('message-failed', message, error)
      return
    }
    try {
      await port.delete(message.receiptHandle)
    } catch (error) {
      this.#emitSafely('message-delete-failed', message, error)
      return
    }
    this.#emitSafely('message-deleted', message)
  }

  // A throwing listener must not kill the polling loop.
  #emitSafely(event: string, ...args: unknown[]): void {
    try {
      this.emit(event, ...args)
    } catch {
      // Listener failures are the listener's to report.
    }
  }
}

function waitForBackoff(signal: AbortSignal, ms: number): Promise<void> {
  return new Promise((resolve) => {
    // Abort events are not replayed: a listener may have closed the consumer already.
    if (signal.aborted) return resolve()
    const finish = () => {
      globalThis.clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = globalThis.setTimeout(finish, ms)
    signal.addEventListener('abort', finish, { once: true })
  })
}

/**
 * A sequential polling consumer over an injected port. A message is deleted only after its handler
 * succeeds; a failed handler leaves it for redelivery after the visibility timeout. `close()` is
 * idempotent, aborts the in-flight receive, and waits for the batch in progress.
 */
export function createSqsConsumer(options: CreateSqsConsumerOptions): SqsConsumer {
  return new SqsConsumerImpl(options)
}
