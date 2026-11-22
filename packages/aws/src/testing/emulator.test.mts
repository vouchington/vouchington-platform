import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import tls from 'node:tls'
import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  platform: 'linux',
  spawn: undefined as unknown as (
    command: string,
    args: string[],
    options: { env: { HOME: string } },
  ) => unknown,
  health: 200 as number | Error,
  docker: undefined as unknown as (opts: { home: string }) => Promise<unknown>,
  homes: [] as string[],
}))

vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:os')>()),
  platform: () => state.platform,
}))
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: (...args: Parameters<typeof state.spawn>) => state.spawn(...args),
}))
vi.mock('node:https', () => ({
  request: (_url: string, _options: unknown, callback: (res: unknown) => void) => {
    const req = new EventEmitter() as EventEmitter & { end: () => void }
    req.end = () =>
      queueMicrotask(() => {
        if (state.health instanceof Error) req.emit('error', state.health)
        else callback({ statusCode: state.health, resume: () => {} })
      })
    return req
  },
}))
vi.mock('./emulator-package.mts', () => ({
  ensureAwsEmulatorBinary: async () => '/cache/aws-emulator',
}))
vi.mock('./emulator-docker.mts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./emulator-docker.mts')>()),
  startAwsEmulatorInDocker: async (opts: { home: string }) => state.docker(opts),
}))

const { startAwsEmulator, trustAwsEmulatorCertificate } = await import('./emulator.mts')

const options = {
  package: { pin: { version: '1', sha256: { amd64: 'a', arm64: 'b' } }, cacheDir: '/cache' },
  dockerImage: 'img',
}
const credentials = 'aws_access_key_id = AKIA\naws_secret_access_key = SECRET\n'

async function writeState(home: string, port: number, creds = credentials) {
  const dir = join(home, '.aws', 'emulator', String(port))
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'ca.pem'), 'CA')
  await writeFile(join(dir, 'emulator_credentials'), creds)
}

class Pipe extends EventEmitter {
  resume() {}
}

class FakeProcess extends EventEmitter {
  stdout = new Pipe()
  stderr = new Pipe()
  pid: number | undefined = 1
  exitCode: number | null = null
  signalCode: string | null = null
  kill = vi.fn((signal: string) => {
    if (signal === 'SIGTERM' && this.exitsOnTerm) queueMicrotask(() => this.emit('exit', 0))
    if (signal === 'SIGKILL') queueMicrotask(() => this.emit('exit', null))
  })
  exitsOnTerm = true
}

function nativeSpawn(port: number, creds?: string, child = new FakeProcess()) {
  state.spawn = (_command, _args, { env }) => {
    state.homes.push(env.HOME)
    void writeState(env.HOME, port, creds).then(() =>
      child.stdout.emit('data', Buffer.from(`{"endpoint_url":"https://127.0.0.1:${port}"}`)),
    )
    return child
  }
  return child
}

afterEach(() => {
  vi.restoreAllMocks()
  state.platform = 'linux'
  state.health = 200
})

describe('startAwsEmulator', () => {
  it('starts the binary natively on Linux and stops it, removing the home directory', async () => {
    const child = nativeSpawn(4000)
    const emulator = await startAwsEmulator({
      ...options,
      namePrefix: 'test-emu',
      region: 'eu-west-1',
    })
    expect(emulator).toMatchObject({
      endpoint: 'https://127.0.0.1:4000',
      region: 'eu-west-1',
      caPem: 'CA',
      accessKeyId: 'AKIA',
      secretAccessKey: 'SECRET',
    })
    expect(state.homes[0]).toContain('test-emu-')
    await emulator.stop()
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    expect(existsSync(state.homes[0]!)).toBe(false)
  })

  it('defaults the region and name prefix', async () => {
    nativeSpawn(4001)
    const emulator = await startAwsEmulator(options)
    expect(emulator.region).toBe('us-west-2')
    expect(state.homes.at(-1)).toContain('aws-emulator-')
    await emulator.stop()
  })

  it('runs in Docker on other platforms and reads the state of the container port', async () => {
    state.platform = 'darwin'
    const stop = vi.fn(async () => {})
    let home = ''
    // The Docker starter receives the temporary home; the state files live under the container port.
    state.docker = async (opts) => {
      home = opts.home
      await writeState(home, 9297)
      return { port: Promise.resolve(5555), statePort: 9297, stop }
    }
    const emulator = await startAwsEmulator(options)
    expect(emulator.endpoint).toBe('https://127.0.0.1:5555')
    await emulator.stop()
    expect(stop).toHaveBeenCalled()
    expect(existsSync(home)).toBe(false)
  })

  it('stops the process and removes the home when startup fails', async () => {
    nativeSpawn(4002, 'nothing useful')
    await expect(startAwsEmulator(options)).rejects.toThrow('wrote no credentials')
    expect(existsSync(state.homes.at(-1)!)).toBe(false)

    nativeSpawn(4003)
    state.health = 503
    await expect(startAwsEmulator(options)).rejects.toThrow('answered health with 503')

    nativeSpawn(4004)
    state.health = new Error('refused')
    await expect(startAwsEmulator(options)).rejects.toThrow('refused')
  })
})

describe('native process shutdown', () => {
  it('skips processes that never started or already exited', async () => {
    const neverStarted = nativeSpawn(
      4010,
      undefined,
      Object.assign(new FakeProcess(), { pid: undefined }),
    )
    const exited = Object.assign(new FakeProcess(), { exitCode: 0 })
    const signaled = Object.assign(new FakeProcess(), { signalCode: 'SIGKILL' })
    for (const child of [neverStarted, exited, signaled]) {
      nativeSpawn(4010, undefined, child)
      const emulator = await startAwsEmulator(options)
      await emulator.stop()
      expect(child.kill).not.toHaveBeenCalled()
    }
  })

  it('kills a process that ignores SIGTERM once the deadline passes', async () => {
    const deadline = new AbortController()
    const spy = vi.spyOn(AbortSignal, 'timeout')
    const child = Object.assign(new FakeProcess(), { exitsOnTerm: false })
    nativeSpawn(4011, undefined, child)
    spy.mockReturnValue(deadline.signal)
    const emulator = await startAwsEmulator(options)
    const stopped = emulator.stop()
    await vi.waitFor(() => expect(child.kill).toHaveBeenCalledWith('SIGTERM'))
    deadline.abort()
    await stopped
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
  })
})

describe('trustAwsEmulatorCertificate', () => {
  it('adds the certificate once', () => {
    const set = vi.spyOn(tls, 'setDefaultCACertificates').mockImplementation(() => {})
    vi.spyOn(tls, 'getCACertificates').mockReturnValue(['existing'])
    trustAwsEmulatorCertificate('new')
    expect(set).toHaveBeenCalledWith(['existing', 'new'])
    set.mockClear()
    trustAwsEmulatorCertificate('existing')
    expect(set).not.toHaveBeenCalled()
  })
})
