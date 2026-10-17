import type { TestQueue } from 'glide-mq/testing'
import { describe, expect, it } from 'vitest'

import { captureFlushDiagnostics, TestQueueFlushTimeoutError } from './flush-diagnostics.mts'

function fakeQueue(overrides: Record<string, unknown> = {}): TestQueue {
  const queued = { state: 'waiting' }
  return {
    workers: new Set([{ getActiveCount: () => 2, concurrency: 3 }]),
    jobs: new Map([
      ['a', queued],
      ['b', { state: 'active' }],
    ]),
    waitingQueue: [queued],
    isPaused: () => true,
    ...overrides,
  } as unknown as TestQueue
}

describe('captureFlushDiagnostics', () => {
  it('snapshots workers, paused state, and pending job placement', () => {
    expect(captureFlushDiagnostics(fakeQueue(), ['a', 'b', 'gone'])).toEqual({
      isPaused: true,
      waitingQueueLength: 1,
      workers: [{ activeCount: 2, concurrency: 3 }],
      pendingJobs: [
        { jobId: 'a', state: 'waiting', inWaitingQueue: true },
        { jobId: 'b', state: 'active', inWaitingQueue: false },
        { jobId: 'gone', state: undefined, inWaitingQueue: false },
      ],
    })
  })

  it('degrades to a partial snapshot when introspection throws an Error', () => {
    const queue = fakeQueue({
      isPaused: () => {
        throw new Error('boom')
      },
    })
    expect(captureFlushDiagnostics(queue, ['a'])).toEqual({
      isPaused: false,
      waitingQueueLength: -1,
      workers: [],
      pendingJobs: [{ jobId: 'a', state: undefined, inWaitingQueue: false }],
      captureError: 'boom',
    })
  })

  it('stringifies non-Error introspection failures', () => {
    const queue = fakeQueue({
      isPaused: () => {
        throw 'plain'
      },
    })
    expect(captureFlushDiagnostics(queue, []).captureError).toBe('plain')
  })
})

describe('TestQueueFlushTimeoutError', () => {
  const diagnostics = {
    isPaused: false,
    waitingQueueLength: 1,
    workers: [{ activeCount: 1, concurrency: 2 }],
    pendingJobs: [
      { jobId: 'a', state: 'waiting', inWaitingQueue: true },
      { jobId: 'b', state: undefined, inWaitingQueue: false },
    ],
  }

  it('summarizes workers and pending jobs', () => {
    const error = new TestQueueFlushTimeoutError('emails', ['a', 'b'], ['a'], 50, diagnostics)
    expect(error.name).toBe('TestQueueFlushTimeoutError')
    expect(error.message).toBe(
      'Timed out waiting for test queue jobs in "emails" [workers active/concurrency: 1/2; ' +
        'waitingQueue: 1; paused: false; pending: a:waiting (queued), b:missing]',
    )
    expect(error).toMatchObject({
      queueName: 'emails',
      jobIds: ['a', 'b'],
      pendingJobIds: ['a'],
      flushTimeoutMs: 50,
      diagnostics,
    })
  })

  it('reports none for empty workers and pending jobs', () => {
    const error = new TestQueueFlushTimeoutError('q', [], [], 1, {
      ...diagnostics,
      workers: [],
      pendingJobs: [],
    })
    expect(error.message).toContain('workers active/concurrency: none')
    expect(error.message).toContain('pending: none')
  })

  it('reports a failed diagnostics capture', () => {
    const error = new TestQueueFlushTimeoutError('q', [], [], 1, {
      ...diagnostics,
      captureError: 'bad',
    })
    expect(error.message).toBe(
      'Timed out waiting for test queue jobs in "q" [diagnostics capture failed: bad]',
    )
  })
})
