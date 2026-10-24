import { describe, expect, it } from 'vitest'
import { abortable } from './oidc-id-token-util.mts'

describe('abortable', () => {
  it('returns the promise itself without a signal', async () => {
    const promise = Promise.resolve(1)
    expect(abortable(promise)).toBe(promise)
  })

  it('resolves and rejects with the underlying promise and removes its listener', async () => {
    const controller = new AbortController()
    await expect(abortable(Promise.resolve(1), controller.signal)).resolves.toBe(1)
    await expect(abortable(Promise.reject(new Error('boom')), controller.signal)).rejects.toThrow(
      'boom',
    )
  })

  it('rejects with the reason when the signal aborts while waiting', async () => {
    const controller = new AbortController()
    const waiting = abortable(new Promise<never>(() => undefined), controller.signal)
    controller.abort(new Error('stop'))
    await expect(waiting).rejects.toThrow('stop')
  })

  it('rejects at once for an aborted signal and swallows the abandoned promise failure', async () => {
    const unhandled: unknown[] = []
    const record = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', record)
    try {
      let fail!: (error: Error) => void
      const abandoned = new Promise<never>((_resolve, reject) => (fail = reject))
      const signal = AbortSignal.abort(new Error('already aborted'))
      await expect(abortable(abandoned, signal)).rejects.toThrow('already aborted')
      fail(new Error('late failure'))
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', record)
    }
  })
})
