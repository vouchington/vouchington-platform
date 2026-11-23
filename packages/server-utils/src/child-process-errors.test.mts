import { describe, expect, it, vi } from 'vitest'
import { CommandFailedError, runCommand } from './child-process-run.mts'

const node = process.execPath

const failure = (stderr: Buffer, extra: { timeoutMs?: number } = {}) =>
  new CommandFailedError('tool', {
    reason: 'exit',
    exitCode: 2,
    signal: null,
    stderr,
    ...extra,
  })

describe('CommandFailedError attributes', () => {
  it('carries the command and omits timeoutMs for non-timeout failures', () => {
    const error = failure(Buffer.from('boom'))
    expect(error.command).toBe('tool')
    expect(error.timeoutMs).toBeUndefined()
    expect(Object.keys(error)).not.toContain('timeoutMs')
  })

  it('carries timeoutMs when the command timed out', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const pending = runCommand({
        command: node,
        args: ['-e', 'setInterval(() => {}, 1000)'],
        timeoutMs: 200,
      }).catch((error: unknown) => error)
      await vi.advanceTimersByTimeAsync(200)
      expect(await pending).toMatchObject({ reason: 'timeout', timeoutMs: 200, command: node })
    } finally {
      vi.useRealTimers()
    }
  })

  it('includes short stderr in the message in full', () => {
    expect(failure(Buffer.from('boom\n')).message).toBe(
      'command exit (tool) exit=2 signal=null: boom',
    )
  })

  it('caps stderr in the message to a tail and keeps the full buffer', () => {
    const stderr = Buffer.from(`${'a'.repeat(5_000)}${'z'.repeat(1_100)}`)
    const error = failure(stderr)
    expect(error.message).toBe(`command exit (tool) exit=2 signal=null: ...${'z'.repeat(1_024)}`)
    expect(error.message.length).toBeLessThan(1_200)
    expect(error.stderr).toBe(stderr)
  })

  it('does not truncate stderr of exactly the cap', () => {
    const error = failure(Buffer.from('x'.repeat(1_024)))
    expect(error.message).toBe(`command exit (tool) exit=2 signal=null: ${'x'.repeat(1_024)}`)
  })

  it('drops a multi-byte character split by the cut', () => {
    const error = failure(Buffer.from(`${'é'.repeat(600)}`))
    expect(error.message).not.toContain('�')
    expect(error.message).toContain(': ...é')
  })

  it('omits the stderr suffix when stderr is empty', () => {
    expect(failure(Buffer.alloc(0)).message).toBe('command exit (tool) exit=2 signal=null')
  })
})

describe('runCommand argument validation', () => {
  it('rejects an empty command with a RangeError carrying the command', async () => {
    const err = await runCommand({ command: '', timeoutMs: 1_000 }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RangeError)
    expect(err).toMatchObject({ message: 'command must not be empty', command: '' })
  })

  it('rejects a non-positive timeout with a RangeError carrying the command', async () => {
    const err = await runCommand({ command: node, timeoutMs: 0 }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RangeError)
    expect(err).toMatchObject({ command: node })
  })

  it('rejects a non-finite timeout with a RangeError', async () => {
    const err = await runCommand({ command: node, timeoutMs: Infinity }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RangeError)
  })

  it('rejects a non-number timeout with a TypeError carrying the command', async () => {
    const err = await runCommand({ command: node, timeoutMs: '5' as never }).catch(
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(TypeError)
    expect(err).toMatchObject({ message: 'timeoutMs must be a number', command: node })
  })

  it('rejects a non-string command with a TypeError', async () => {
    const err = await runCommand({ command: 42 as never, timeoutMs: 1_000 }).catch(
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(TypeError)
    expect(err).toMatchObject({ message: 'command must be a string', command: '42' })
  })
})
