import type { TestWorker } from 'glide-mq/testing'
import { describe, expect, it, vi } from 'vitest'

import { observeTestWorkerActivity } from './worker-activity.mts'

describe('observeTestWorkerActivity', () => {
  it('retains an already active worker until its processor slot exits', () => {
    const worker = Object.defineProperty({ id: 'already-active' }, 'activeCount', {
      configurable: true,
      value: 1,
      writable: true,
    }) as TestWorker
    const activeWorkers = new Set<TestWorker>()
    const notify = vi.fn()

    observeTestWorkerActivity(worker, activeWorkers, notify)
    expect(activeWorkers.has(worker)).toBe(true)
    expect(Object.getOwnPropertyDescriptor(worker, 'activeCount')?.enumerable).toBe(false)
    Reflect.set(worker, 'activeCount', 0)
    expect(activeWorkers.has(worker)).toBe(false)
    expect(notify).toHaveBeenCalledOnce()
  })

  it('rejects workers whose processor slot cannot be observed', () => {
    const activeWorkers = new Set<TestWorker>()
    const notify = vi.fn()
    const missing = {} as TestWorker
    const fixed = Object.defineProperty({}, 'activeCount', { value: 0 }) as TestWorker
    const nonNumeric = Object.defineProperty({}, 'activeCount', {
      configurable: true,
      value: 'active',
    }) as TestWorker

    for (const worker of [missing, fixed, nonNumeric]) {
      expect(() => observeTestWorkerActivity(worker, activeWorkers, notify)).toThrow(
        'GlideMQ TestWorker active-slot counter is not observable',
      )
    }
    expect(activeWorkers.size).toBe(0)
    expect(notify).not.toHaveBeenCalled()
  })
})
