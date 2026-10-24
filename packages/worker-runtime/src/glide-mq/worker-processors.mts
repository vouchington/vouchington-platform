import { getTestWorkerProcessorDecorator } from '../test-processor-decorator.mts'

type AnyProcessor = (...args: any[]) => any
type Wrapper = ((processor: any, queueName: string) => any) | undefined

/**
 * Applies the optional config-level wrapper innermost, then the global test decorator outermost.
 * The runtime wraps directly because glide-mq ignores a `wrapProcessor` worker option.
 */
export function decorateProcessor<P extends AnyProcessor>(
  processor: P,
  queueName: string,
  wrap: Wrapper,
): P {
  const wrapped = wrap ? (wrap(processor, queueName) as P) : processor
  const decorator = getTestWorkerProcessorDecorator()
  return decorator ? (decorator(wrapped, queueName) as P) : wrapped
}

/**
 * glide-mq closes only a command client it created, so a worker handed a dedicated client must
 * release it itself. Wrapping `close()` covers graceful shutdown, direct calls, and glide-mq's own
 * internal close, and the client is released even when the worker close fails.
 */
export function closeCommandClientWithWorker(
  worker: { close(force?: boolean): Promise<void> },
  dedicated: { close(): Promise<void> },
  onError: (error: Error) => void,
): void {
  const closeWorker = worker.close.bind(worker)
  worker.close = async function closeWorkerAndCommandClient(force?: boolean): Promise<void> {
    try {
      await closeWorker(force)
    } finally {
      await dedicated.close().catch((error: unknown) => {
        onError(error instanceof Error ? error : new Error(String(error)))
      })
    }
  }
}
