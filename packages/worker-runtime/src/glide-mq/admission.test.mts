import { afterEach, describe, expect, it, vi } from 'vitest'

import { onEnqueueAdmission, publishEnqueueAdmission, type EnqueueAdmission } from './admission.mts'

const identity = (completion: Promise<unknown> = Promise.resolve()) => ({
  queue: {},
  queueName: 'q',
  jobName: 'job',
  inputs: [{ a: 1 }],
  completion,
})

const unsubscribes: Array<() => void> = []
const listen = (listener: (event: EnqueueAdmission) => undefined) => {
  const off = onEnqueueAdmission(listener)
  unsubscribes.push(off)
  return off
}

afterEach(() => {
  for (const off of unsubscribes.splice(0)) off()
})

describe('enqueue admission', () => {
  it('notifies listeners with the identity and the original promise', () => {
    const completion = Promise.resolve('job')
    const seen: EnqueueAdmission[] = []
    listen((event) => void seen.push(event))

    publishEnqueueAdmission(identity(completion))

    expect(seen[0]).toMatchObject({ queueName: 'q', jobName: 'job', inputs: [{ a: 1 }] })
    expect(seen[0]!.completion).toBe(completion)
    expect(seen[0]!.observerErrors).toEqual([])
  })

  it('stops notifying after unsubscribe, and tolerates unsubscribing while publishing', () => {
    const first = vi.fn<(event: EnqueueAdmission) => undefined>()
    const off = listen(first)
    const second = vi.fn<(event: EnqueueAdmission) => undefined>()
    listen(() => {
      off()
      return undefined
    })
    listen(second)

    publishEnqueueAdmission(identity())
    publishEnqueueAdmission(identity())

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(2)
  })

  it('records a throwing observer, reports it, and keeps notifying the rest', () => {
    const failure = new Error('observer failed')
    const after = vi.fn<(event: EnqueueAdmission) => undefined>()
    const report = vi.fn()
    let event: EnqueueAdmission | undefined
    listen((e) => {
      event = e
      throw failure
    })
    listen(after)

    publishEnqueueAdmission(identity(), report)

    expect(event?.observerErrors).toEqual([failure])
    expect(report).toHaveBeenCalledWith(failure)
    expect(after).toHaveBeenCalledTimes(1)
  })

  it('wraps non-Error observer failures', () => {
    const report = vi.fn()
    listen(() => {
      throw 'text'
    })

    publishEnqueueAdmission(identity(), report)

    expect(report).toHaveBeenCalledWith(expect.objectContaining({ cause: 'text' }))
  })

  it('records a throwing reporter in reportingErrors and tolerates a missing reporter', () => {
    const reportingFailure = new Error('report failed')
    let event: EnqueueAdmission | undefined
    listen((e) => {
      event = e
      throw new Error('observer failed')
    })

    expect(() =>
      publishEnqueueAdmission(identity(), () => {
        throw reportingFailure
      }),
    ).not.toThrow()
    expect(event?.reportingErrors).toEqual([reportingFailure])
    expect(() => publishEnqueueAdmission(identity())).not.toThrow()
  })
})
