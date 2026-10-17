import { AsyncLocalStorage } from 'node:async_hooks'

const testWorkerProcessorContext = new AsyncLocalStorage<true>()

/** Suppress automatic flushing for nested processors and native explicit-wait/replay APIs. */
export function runInsideTestWorkerProcessor<T>(fn: () => T): T {
  return testWorkerProcessorContext.run(true, fn)
}

export function isInsideTestWorkerProcessor(): boolean {
  return testWorkerProcessorContext.getStore() === true
}
