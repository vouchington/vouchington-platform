import { afterEach, describe, expect, it, vi } from 'vitest'
import { runCommand } from './child-process-run.mts'

const node = process.execPath
const args = ['-e', 'process.stdout.write("hi")']

type WriteCallback = (err?: Error | null) => void

function stubStdoutWrite(
  onWrite: (callback: WriteCallback | undefined, isFlush: boolean) => void,
): void {
  vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
    onWrite(
      rest.find((arg) => typeof arg === 'function') as WriteCallback | undefined,
      chunk === '',
    )
    return true
  }) as typeof process.stdout.write)
}

describe('runCommand with a shared stdout', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('flushes the shared stream, leaves it open, and removes its error listener', async () => {
    stubStdoutWrite((callback) => callback?.(null))
    const listeners = process.stdout.listenerCount('error')
    await expect(
      runCommand({ command: node, args, stdout: process.stdout, timeoutMs: 5_000 }),
    ).resolves.toMatchObject({ stderr: expect.any(Buffer) })
    expect(process.stdout.destroyed).toBe(false)
    expect(process.stdout.listenerCount('error')).toBe(listeners)
  })

  it('rejects when a delayed shared write fails after the child closes', async () => {
    const flushStarted = Promise.withResolvers<void>()
    let flush: WriteCallback | undefined
    stubStdoutWrite((callback, isFlush) => {
      if (!isFlush) return
      flush = callback
      flushStarted.resolve()
    })
    const rejection = runCommand({
      command: node,
      args,
      stdout: process.stdout,
      timeoutMs: 5_000,
    }).catch((err: unknown) => err)
    await flushStarted.promise
    const failure = new Error('socket write failed')
    flush?.(failure)
    expect(await rejection).toBe(failure)
  })

  it('stops waiting on the shared flush once the caller aborts', async () => {
    const controller = new AbortController()
    const flushStarted = Promise.withResolvers<void>()
    stubStdoutWrite((_callback, isFlush) => {
      if (isFlush) flushStarted.resolve()
    })
    const rejection = runCommand({
      command: node,
      args,
      stdout: process.stdout,
      timeoutMs: 5_000,
      signal: controller.signal,
    }).catch((err: unknown) => err)
    await flushStarted.promise
    controller.abort()
    expect(await rejection).toMatchObject({ reason: 'abort' })
  })

  it('skips the flush when cancellation already happened', async () => {
    const controller = new AbortController()
    stubStdoutWrite((callback) => {
      controller.abort()
      callback?.(null)
    })
    const result = await runCommand({
      command: node,
      args,
      stdout: process.stdout,
      timeoutMs: 5_000,
      signal: controller.signal,
    }).catch((err: unknown) => err)
    expect(result).toMatchObject({ reason: 'abort' })
  })
})
