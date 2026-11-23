import { spawn } from 'node:child_process'
import { Writable } from 'node:stream'
import { finished } from 'node:stream/promises'
import { CommandFailedError } from './child-process-error.mts'
import {
  classifyFailure,
  collectCappedStderr,
  destroyChildPipes,
  isSharedOutput,
  killChild,
  pipeStdin,
  pipeStdout,
  waitForChild,
} from './child-process-process.mts'

const DEFAULT_STDERR_CAP_BYTES = 65_536

export type { CommandFailureReason } from './child-process-error.mts'
export { CommandFailedError } from './child-process-error.mts'

export type RunCommandOptions = {
  command: string
  args?: readonly string[]
  stdin?: ReadableStreamInput
  stdout?: Writable
  signal?: AbortSignal
  timeoutMs: number
  stderrCapBytes?: number
  /** Replaces the default child environment (PATH, TMPDIR, and `LC_ALL=C` only). */
  env?: NodeJS.ProcessEnv
}

type ReadableStreamInput = import('node:stream').Readable | Uint8Array | string

// Spawns `command` with an explicit argv and no shell. Stdin and stdout stay
// streams. Stderr is retained only up to a byte cap. By default the child receives
// PATH, TMPDIR, and `LC_ALL=C` only. Abort and the timeout both SIGKILL the child;
// a non-zero exit or a signal rejects.
export async function runCommand(options: RunCommandOptions): Promise<{ stderr: Buffer }> {
  validateOptions(options)
  if (options.signal?.aborted) {
    throw new CommandFailedError(options.command, {
      reason: 'abort',
      exitCode: null,
      signal: null,
      stderr: Buffer.alloc(0),
    })
  }

  const child = spawn(options.command, [...(options.args ?? [])], {
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: options.env ?? childEnvironment(),
  })

  let aborted = false
  let timedOut = false
  let stdinError: Error | undefined
  let stdoutError: Error | undefined
  const outputCancellation = new AbortController()
  const stderr = collectCappedStderr(child, options.stderrCapBytes ?? DEFAULT_STDERR_CAP_BYTES)
  pipeStdin(child, options.stdin, (err) => {
    stdinError = err
  })
  const releaseStdout = pipeStdout(child, options.stdout, (err) => {
    stdoutError = err
    killChild(child)
  })

  const destroyStdout = () => {
    if (options.stdout && !isSharedOutput(options.stdout) && !options.stdout.writableFinished)
      options.stdout.destroy()
  }
  // Destroying the child's pipes lets `close` fire even when a grandchild holds them open.
  const cancel = () => {
    killChild(child)
    destroyChildPipes(child)
    outputCancellation.abort()
    destroyStdout()
  }
  const onAbort = () => {
    aborted = true
    cancel()
  }
  options.signal?.addEventListener('abort', onAbort, { once: true })
  // Stream setup hooks may have aborted before the listener existed; abort events are not replayed.
  if (options.signal?.aborted) onAbort()
  const timer = setTimeout(() => {
    timedOut = true
    cancel()
  }, options.timeoutMs)
  timer.unref()

  try {
    const outcome = await waitForChild(child)
    if (outcome.kind === 'error') {
      destroyStdout()
      throw outcome.error
    }
    // The child can close before an async stdout destination finishes its writes.
    await settleStdout(options.stdout, outputCancellation.signal, (err) => {
      if (!stdoutError) stdoutError = err
    })
    const failure = classifyFailure({
      command: options.command,
      timeoutMs: options.timeoutMs,
      aborted,
      timedOut,
      stdinError,
      stdoutError,
      exitCode: outcome.exitCode,
      signal: outcome.signal,
      stderr: stderr.bytes(),
    })
    if (failure) throw failure
    return { stderr: stderr.bytes() }
  } finally {
    clearTimeout(timer)
    releaseStdout()
    options.signal?.removeEventListener('abort', onAbort)
  }
}

function argumentError<E extends Error>(error: E, command: unknown): E & { command: string } {
  return Object.assign(error, { command: String(command) })
}

function validateOptions(options: RunCommandOptions): void {
  const { command, timeoutMs } = options
  if (typeof command !== 'string')
    throw argumentError(new TypeError('command must be a string'), command)
  if (command.length === 0)
    throw argumentError(new RangeError('command must not be empty'), command)
  if (typeof timeoutMs !== 'number')
    throw argumentError(new TypeError('timeoutMs must be a number'), command)
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw argumentError(new RangeError('timeoutMs must be a positive finite number'), command)
}

function childEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { LC_ALL: 'C' }
  const path = process.env.PATH
  const tempDir = process.env.TMPDIR
  if (path !== undefined) env.PATH = path
  if (tempDir !== undefined) env.TMPDIR = tempDir
  return env
}

async function settleStdout(
  stdout: Writable | undefined,
  cancellation: AbortSignal,
  onError: (err: Error) => void,
): Promise<void> {
  if (!stdout || cancellation.aborted) return
  const settled = isSharedOutput(stdout)
    ? new Promise<void>((resolve, reject) => {
        stdout.write('', (err) => (err ? reject(err) : resolve()))
      })
    : finished(stdout, { readable: false })
  let onCancel!: () => void
  const cancelled = new Promise<void>((resolve) => {
    onCancel = resolve
    cancellation.addEventListener('abort', onCancel, { once: true })
  })
  try {
    // Cancellation wins so a destination with slow cleanup cannot outlive the timeout.
    await Promise.race([settled, cancelled])
  } catch (err) {
    onError(err as Error)
  } finally {
    cancellation.removeEventListener('abort', onCancel)
  }
}
