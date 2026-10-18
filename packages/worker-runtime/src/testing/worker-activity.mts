import type { TestWorker } from 'glide-mq/testing'

/** Track processor slots after record removal or worker detachment until their callbacks exit. */
export function observeTestWorkerActivity(
  worker: TestWorker,
  activeWorkers: Set<TestWorker>,
  notify: () => void,
): void {
  const descriptor = Object.getOwnPropertyDescriptor(worker, 'activeCount')
  if (!descriptor?.configurable || typeof descriptor.value !== 'number') {
    throw new Error('GlideMQ TestWorker active-slot counter is not observable')
  }
  let activeCount: number = descriptor.value
  if (activeCount > 0) activeWorkers.add(worker)
  Object.defineProperty(worker, 'activeCount', {
    configurable: descriptor.configurable,
    enumerable: descriptor.enumerable ?? false,
    get: () => activeCount,
    set: (next: number) => {
      activeCount = next
      if (next > 0) activeWorkers.add(worker)
      else activeWorkers.delete(worker)
      notify()
    },
  })
}
