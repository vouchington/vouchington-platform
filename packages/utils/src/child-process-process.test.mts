import { EventEmitter, PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { pipeStdin, pipeStdout } from './child-process-process.mts'

describe('runCommand process edges', () => {
  it('ignores a closed stdin pipe and kills the child on any other stdin error', () => {
    const closed = fakeChild()
    const ignore = vi.fn<(err: Error) => void>()
    pipeStdin(closed, undefined, ignore)
    closed.stdin?.emit('error', errno('EPIPE'))
    expect(ignore).not.toHaveBeenCalled()

    const broken = fakeChild()
    const report = vi.fn<(err: Error) => void>()
    pipeStdin(broken, undefined, report)
    broken.stdin?.emit('error', errno('EIO'))
    expect(report).toHaveBeenCalledOnce()
    expect(broken.killMock).toHaveBeenCalledWith('SIGKILL')
  })

  it('kills the child when a streamed stdin fails, and reports stdout source errors', () => {
    const child = fakeChild()
    const report = vi.fn<(err: Error) => void>()
    const source = new PassThrough()
    pipeStdin(child, source, report)
    source.emit('error', new Error('source failed'))
    expect(report).toHaveBeenCalledOnce()
    expect(child.killMock).toHaveBeenCalledWith('SIGKILL')

    const output = fakeChild()
    const stdoutReport = vi.fn<(err: Error) => void>()
    pipeStdout(output, new PassThrough(), stdoutReport)
    output.stdout?.emit('error', errno('ERR_STREAM_PREMATURE_CLOSE'))
    output.stdout?.emit('error', errno('EIO'))
    expect(stdoutReport).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'ERR_STREAM_PREMATURE_CLOSE' }),
    )
    expect(stdoutReport).toHaveBeenCalledWith(expect.objectContaining({ code: 'EIO' }))

    const destination = new PassThrough()
    const destinationReport = vi.fn<(err: Error) => void>()
    pipeStdout(output, destination, destinationReport)
    destination.emit('error', new Error('dest failed'))
    expect(destinationReport).toHaveBeenCalledOnce()
  })

  it('releases a streamed stdin once when the child errors and then closes', () => {
    const child = fakeChild()
    const report = vi.fn<(err: Error) => void>()
    const source = new PassThrough()
    pipeStdin(child, source, report)
    child.emit('error', new Error('spawn failed'))
    child.emit('close', null, null)
    expect(source.destroyed).toBe(true)
    expect(source.listenerCount('error')).toBe(0)
    expect(report).not.toHaveBeenCalled()
  })

  it('destroys an unfinished stdin and drops its error listener when the child closes', () => {
    const child = fakeChild()
    const report = vi.fn<(err: Error) => void>()
    const source = new PassThrough()
    pipeStdin(child, source, report)
    child.emit('close', 0, null)
    expect(source.destroyed).toBe(true)
    expect(source.listenerCount('error')).toBe(0)
    expect(report).not.toHaveBeenCalled()
  })
})

type FakeChild = ChildProcess & { killMock: ReturnType<typeof vi.fn> }

function fakeChild(): FakeChild {
  const kill = vi.fn<(signal?: NodeJS.Signals | number) => boolean>()
  const child = new EventEmitter() as FakeChild
  Object.assign(child, {
    killMock: kill,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    signalCode: null,
    kill,
  })
  return child
}

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code })
}
