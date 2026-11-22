import { EventEmitter } from 'node:events'
import { resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  execCalls: [] as string[][],
  execResult: (_args: string[]): { stdout: string } | Error => ({ stdout: '' }),
  spawned: undefined as unknown,
}))

vi.mock('node:child_process', () => ({
  execFile: (
    command: string,
    args: string[],
    _options: unknown,
    callback: (error: Error | null, result?: { stdout: string; stderr: string }) => void,
  ) => {
    state.execCalls.push([command, ...args])
    const result = state.execResult(args)
    if (result instanceof Error) callback(result)
    else callback(null, { stdout: result.stdout, stderr: '' })
  },
  spawn: () => state.spawned,
}))

const { AWS_EMULATOR_IDLE_TIMEOUT_SECONDS, readAnnouncedPort, startAwsEmulatorInDocker } =
  await import('./emulator-docker.mts')

class FakeChild extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  kill = vi.fn()
}
const announce = '{"endpoint_url":"https://127.0.0.1:9297"}\n'

afterEach(() => {
  vi.restoreAllMocks()
  state.execCalls = []
  state.execResult = () => ({ stdout: '' })
})

describe('readAnnouncedPort', () => {
  it('resolves with the announced port from stdout or stderr, split across chunks', async () => {
    const child = new FakeChild()
    const port = readAnnouncedPort(child as never)
    child.stderr.write('booting\n{"endpoint_url":"https://127.0.')
    child.stderr.write('0.1:4242"}\n')
    await expect(port).resolves.toBe(4242)
  })

  it('rejects when the process exits, fails to start, or the deadline passes', async () => {
    const exited = new FakeChild()
    const exitedPort = readAnnouncedPort(exited as never)
    exited.stdout.write('log line')
    exited.emit('exit', 3)
    await expect(exitedPort).rejects.toThrow('exited with 3 before it was ready:\nlog line')

    const broken = new FakeChild()
    const brokenPort = readAnnouncedPort(broken as never)
    broken.emit('error', new Error('ENOENT'))
    await expect(brokenPort).rejects.toThrow('failed to start')

    const deadline = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
    const slow = new FakeChild()
    const slowPort = readAnnouncedPort(slow as never)
    deadline.abort()
    await expect(slowPort).rejects.toThrow('did not announce its endpoint')
  })

  it('ignores a child without pipes', async () => {
    const child = new FakeChild()
    const port = readAnnouncedPort(Object.assign(child, { stdout: null, stderr: null }) as never)
    child.emit('error', new Error('x'))
    await expect(port).rejects.toThrow()
  })
})

describe('startAwsEmulatorInDocker', () => {
  function setup(portOutput = '127.0.0.1:49153\n') {
    const logs = new FakeChild()
    state.spawned = logs
    state.execResult = (args) => (args[0] === 'port' ? { stdout: portOutput } : { stdout: '' })
    queueMicrotask(() => logs.stdout.write(announce))
    return logs
  }

  it('runs the binary in a container with the injected image and resolves the host port', async () => {
    const logs = setup()
    const started = await startAwsEmulatorInDocker({
      home: '/tmp/home',
      binary: '/cache/aws-emulator',
      image: 'example/node:1',
      containerNamePrefix: 'my-emulator',
    })
    expect(await started.port).toBe(49153)
    expect(started.statePort).toBe(9297)
    expect(logs.kill).toHaveBeenCalled()
    const run = state.execCalls[0]!
    expect(run.slice(0, 2)).toEqual(['docker', 'run'])
    expect(run).toContain('example/node:1')
    expect(run).toContain('/cache/aws-emulator:/usr/local/bin/aws-emulator:ro')
    expect(run).toContain('/tmp/home:/tmp/home')
    expect(run[run.indexOf('--name') + 1]).toMatch(/^my-emulator-\d+-\d+$/)
    expect(run.at(-1)).toBe(String(AWS_EMULATOR_IDLE_TIMEOUT_SECONDS))
    await started.stop()
    expect(state.execCalls.at(-1)?.slice(0, 3)).toEqual(['docker', 'rm', '--force'])
  })

  it('mounts an absolute host path when the binary path is relative', async () => {
    setup()
    const started = await startAwsEmulatorInDocker({
      home: '/h',
      binary: 'cache/aws-emulator',
      image: 'img',
    })
    await started.port
    expect(state.execCalls[0]).toContain(
      `${resolve('cache/aws-emulator')}:/usr/local/bin/aws-emulator:ro`,
    )
  })

  it('uses the default container name prefix, tolerates a failing rm, and rejects an unreadable port', async () => {
    setup('no port here')
    const started = await startAwsEmulatorInDocker({
      home: '/h',
      binary: '/b',
      image: 'img',
    })
    expect(state.execCalls[0]?.[state.execCalls[0].indexOf('--name') + 1]).toMatch(
      /^aws-emulator-\d+-\d+$/,
    )
    await expect(started.port).rejects.toThrow('Could not read the published AWS Emulator port')
    state.execResult = () => new Error('gone')
    await expect(started.stop()).resolves.toBeUndefined()
  })

  it('falls back to uid 1000 where the platform has no getuid', async () => {
    setup()
    const { getuid, getgid } = process
    Object.assign(process, { getuid: undefined, getgid: undefined })
    try {
      const started = await startAwsEmulatorInDocker({ home: '/h', binary: '/b', image: 'img' })
      await started.port
      const run = state.execCalls[0]!
      expect(run[run.indexOf('--user') + 1]).toBe('1000:1000')
    } finally {
      Object.assign(process, { getuid, getgid })
    }
  })
})
