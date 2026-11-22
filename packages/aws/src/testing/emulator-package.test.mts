import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ arch: 'x64', execCalls: [] as string[][] }))

vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:os')>()),
  arch: () => state.arch,
}))
vi.mock('node:child_process', () => ({
  execFile: (
    command: string,
    args: string[],
    _options: unknown,
    callback: (error: Error | null, result: { stdout: string; stderr: string }) => void,
  ) => {
    state.execCalls.push([command, ...args])
    // args are `-c script deb staging`; emulate the extraction into staging.
    const staging = args[3]!
    void mkdir(join(staging, 'opt', 'aws-emulator', 'bin'), { recursive: true })
      .then(() => writeFile(join(staging, 'opt', 'aws-emulator', 'bin', 'aws-emulator'), 'bin'))
      .then(() => callback(null, { stdout: '', stderr: '' }))
  },
}))

const { debArch, ensureAwsEmulatorBinary } = await import('./emulator-package.mts')

const payload = Buffer.from('deb-bytes')
const digest = createHash('sha256').update(payload).digest('hex')
const pin = { version: '1.2.3', sha256: { amd64: digest, arm64: digest } }

let cacheDir: string
beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'emulator-package-'))
  state.execCalls = []
})
afterEach(() => rm(cacheDir, { recursive: true, force: true }))

const ok = () =>
  vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(payload))

describe('debArch', () => {
  it('maps node architectures to Debian architectures', () => {
    state.arch = 'x64'
    expect(debArch()).toBe('amd64')
    state.arch = 'arm64'
    expect(debArch()).toBe('arm64')
    state.arch = 'ia32'
    expect(() => debArch()).toThrow('ships no Linux package for ia32')
    state.arch = 'x64'
  })
})

describe('ensureAwsEmulatorBinary', () => {
  it('downloads, verifies and extracts once, then serves the cache', async () => {
    const fetchMock = ok()
    const options = { pin, cacheDir, fetch: fetchMock, baseUrl: 'https://example.test/pkg' }
    const binary = await ensureAwsEmulatorBinary(options)
    expect(binary).toBe(join(cacheDir, '1.2.3', 'amd64', 'aws-emulator'))
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://example.test/pkg/aws-emulator_1.2.3-1_amd64.deb',
    )
    expect(state.execCalls).toHaveLength(1)
    expect(await readdir(join(cacheDir, '1.2.3', 'amd64'))).toEqual(['aws-emulator'])
    expect(await ensureAwsEmulatorBinary(options)).toBe(binary)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('defaults to the global fetch, the AWS download host and the host architecture', async () => {
    state.arch = 'arm64'
    const globalFetch = ok()
    vi.stubGlobal('fetch', globalFetch)
    const binary = await ensureAwsEmulatorBinary({ pin, cacheDir })
    expect(binary).toContain(join('1.2.3', 'arm64'))
    expect(globalFetch.mock.calls[0]?.[0]).toBe(
      'https://downloads.aws.com/aws-emulator/packages/aws-emulator/LTS/aws-emulator_1.2.3-1_arm64.deb',
    )
    vi.unstubAllGlobals()
    state.arch = 'x64'
  })

  it('rejects failed downloads and bodiless responses', async () => {
    await expect(
      ensureAwsEmulatorBinary({
        pin,
        cacheDir,
        fetch: vi.fn(async () => new Response('no', { status: 404 })),
      }),
    ).rejects.toThrow('download failed: 404')
    await expect(
      ensureAwsEmulatorBinary({
        pin,
        cacheDir,
        fetch: vi.fn(async () => new Response(null, { status: 200 })),
      }),
    ).rejects.toThrow('download failed: 200')
  })

  it('rejects a digest mismatch and removes the staging directory', async () => {
    const bad = { version: '9.9.9', sha256: { amd64: 'f'.repeat(64), arm64: 'f'.repeat(64) } }
    await expect(
      ensureAwsEmulatorBinary({ pin: bad, cacheDir, fetch: ok(), target: 'amd64' }),
    ).rejects.toThrow('does not match pinned')
    expect(existsSync(join(cacheDir, '9.9.9', 'amd64', 'aws-emulator'))).toBe(false)
    expect(await readdir(join(cacheDir, '9.9.9', 'amd64'))).toEqual([])
  })
})
