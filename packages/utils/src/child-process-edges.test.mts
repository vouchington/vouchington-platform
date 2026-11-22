import { EventEmitter, PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runCommand } from './child-process-run.mts'
import { collectCappedStderr, pipeStdin, pipeStdout } from './child-process-process.mts'

function pipeless(): ChildProcess {
  return Object.assign(new EventEmitter(), {
    stdin: null,
    stdout: null,
    stderr: null,
    exitCode: null,
    signalCode: null,
  }) as unknown as ChildProcess
}

function piped(): ChildProcess {
  return Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    signalCode: null,
    kill: vi.fn<() => boolean>(),
  }) as unknown as ChildProcess
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('child process edges', () => {
  it('rejects a child without stdio pipes', () => {
    const child = pipeless()
    expect(() => pipeStdin(child, undefined, () => {})).toThrow('child stdin is not a pipe')
    expect(() => pipeStdout(child, undefined, () => {})).toThrow('child stdout is not a pipe')
    expect(() => collectCappedStderr(child, 4)).toThrow('child stderr is not a pipe')
  })

  it('keeps a fully read stdin source alive when the child closes', async () => {
    const child = piped()
    const source = new PassThrough()
    const destroy = vi.spyOn(source, 'destroy')
    pipeStdin(child, source, () => {})
    source.end()
    source.resume()
    await new Promise<void>((resolve) => source.once('end', resolve))
    destroy.mockClear()
    child.emit('close', 0, null)
    expect(destroy).not.toHaveBeenCalled()
  })

  it('does not destroy a shared output when the child stdout errors', () => {
    const child = piped()
    const destroy = vi.spyOn(process.stdout, 'destroy')
    vi.spyOn(child.stdout as PassThrough, 'pipe').mockReturnValue(process.stdout)
    const onError = vi.fn<(err: Error) => void>()
    const release = pipeStdout(child, process.stdout, onError)
    child.stdout?.emit('error', new Error('read failed'))
    release()
    expect(onError).toHaveBeenCalledOnce()
    expect(destroy).not.toHaveBeenCalled()
  })

  it('stops retaining stderr once the cap is reached', () => {
    const child = piped()
    const stderr = collectCappedStderr(child, 3)
    child.stderr?.emit('data', Buffer.from('abcdef'))
    child.stderr?.emit('data', Buffer.from('ghi'))
    expect(stderr.bytes().toString('utf8')).toBe('abc')
  })
})

describe('runCommand edges', () => {
  it('rejects when the command cannot be spawned', async () => {
    await expect(
      runCommand({ command: '/nonexistent/vouchington-binary', timeoutMs: 1_000 }),
    ).rejects.toThrow('ENOENT')
  })

  it('runs without args and without PATH or TMPDIR in the parent', async () => {
    vi.stubEnv('PATH', undefined)
    vi.stubEnv('TMPDIR', undefined)
    const result = await runCommand({ command: process.execPath, timeoutMs: 2_000, stdin: '' })
    expect(result.stderr).toHaveLength(0)
  })
})
