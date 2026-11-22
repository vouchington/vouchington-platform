import { PassThrough, Readable, Writable } from 'node:stream'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { runCommand } from './child-process-run.mts'

const node = process.execPath

describe('runCommand stdout settlement', () => {
  it('forwards output to process.stdout without ending the shared stream', async () => {
    const moduleUrl = new URL('./child-process-run.mts', import.meta.url).href
    const script = `import { runCommand } from ${JSON.stringify(moduleUrl)};
      const listeners = process.stdout.listenerCount('error');
      await runCommand({ command: process.execPath, args: ['-e', 'process.stdout.write("hi")'], stdout: process.stdout, timeoutMs: 1_000 });
      if (process.stdout.destroyed) throw new Error('shared stdout destroyed');
      if (process.stdout.listenerCount('error') !== listeners) throw new Error('shared stdout listener leaked')`
    const child = spawn(node, ['--input-type=module', '-e', script], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    const [exitCode] = await once(child, 'close')
    expect({ exitCode, stderr: Buffer.concat(stderr).toString('utf8') }).toEqual({
      exitCode: 0,
      stderr: '',
    })
    expect(Buffer.concat(stdout).toString('utf8')).toBe('hi')
  })

  it('finishes writing to a PassThrough without waiting for its readable side', async () => {
    const stdout = new PassThrough()
    await expect(
      runCommand({
        command: node,
        args: ['-e', 'process.stdout.write("hi")'],
        stdout,
        timeoutMs: 2_000,
      }),
    ).resolves.toMatchObject({ stderr: expect.any(Buffer) })
    expect(stdout.read().toString()).toBe('hi')
  })

  it('keeps cancellation active while a stdout write settles after source end', async () => {
    const controller = new AbortController()
    const writeStarted = Promise.withResolvers<void>()
    const sourceEnded = Promise.withResolvers<void>()
    const stdout = new Writable({
      write() {
        writeStarted.resolve()
      },
    })
    stdout.on('pipe', (source: Readable) => {
      source.once('end', () => sourceEnded.resolve())
    })
    const pending = runCommand({
      command: node,
      args: ['-e', 'process.stdout.write("hi")'],
      stdout,
      timeoutMs: 2_000,
      signal: controller.signal,
    })
    const rejection = pending.catch((err: unknown) => err)
    await writeStarted.promise
    await sourceEnded.promise
    controller.abort()
    expect(await rejection).toMatchObject({ reason: 'abort' })
    expect(stdout.destroyed).toBe(true)
  })

  it('keeps the deadline active while a stdout write settles after source end', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const writeStarted = Promise.withResolvers<void>()
      const sourceEnded = Promise.withResolvers<void>()
      const stdout = new Writable({
        write() {
          writeStarted.resolve()
        },
      })
      stdout.on('pipe', (source: Readable) => {
        source.once('end', () => sourceEnded.resolve())
      })
      const pending = runCommand({
        command: node,
        args: ['-e', 'process.stdout.write("hi")'],
        stdout,
        timeoutMs: 200,
      })
      const rejection = pending.catch((err: unknown) => err)
      await writeStarted.promise
      await sourceEnded.promise
      await vi.advanceTimersByTimeAsync(200)
      expect(await rejection).toMatchObject({ reason: 'timeout' })
      expect(stdout.destroyed).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
