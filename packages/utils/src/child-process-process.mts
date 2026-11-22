import type { ChildProcess } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import { CommandFailedError, type CommandFailureReason } from './child-process-error.mts'

export function killChild(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGKILL')
}

export function isSharedOutput(stdout: Writable): boolean {
  return stdout === process.stdout || stdout === process.stderr
}

export function pipeStdin(
  child: ChildProcess,
  stdin: Readable | Uint8Array | string | undefined,
  onError: (err: Error) => void,
): void {
  const input = child.stdin
  if (!input) throw new Error('child stdin is not a pipe')
  input.on('error', (err) => {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EPIPE' || code === 'ERR_STREAM_PREMATURE_CLOSE') return
    onError(err)
    killChild(child)
  })
  if (stdin === undefined) {
    input.end()
    return
  }
  if (typeof stdin === 'string' || stdin instanceof Uint8Array) {
    input.end(stdin)
    return
  }
  const onSourceError = (err: Error) => {
    onError(err)
    killChild(child)
  }
  stdin.on('error', onSourceError)
  // A child that exits first leaves a Readable paused with its descriptor open.
  let released = false
  const releaseStdin = () => {
    if (released) return
    released = true
    stdin.removeListener('error', onSourceError)
    if (!stdin.readableEnded) stdin.destroy()
  }
  child.once('close', releaseStdin)
  child.once('error', releaseStdin)
  stdin.pipe(input)
}

export function pipeStdout(
  child: ChildProcess,
  stdout: Writable | undefined,
  onError: (err: Error) => void,
): () => void {
  const output = child.stdout
  if (!output) throw new Error('child stdout is not a pipe')
  if (!stdout) {
    output.resume()
    return () => {}
  }
  output.on('error', (err) => {
    onError(err)
    // pipe() does not end its destination when the source errors.
    if (!isSharedOutput(stdout)) stdout.destroy(err)
    killChild(child)
  })
  const onDestinationError = (err: Error) => onError(err)
  stdout.on('error', onDestinationError)
  output.pipe(stdout)
  // Shared streams outlive the command; the caller removes this once writes settle.
  return () => {
    if (isSharedOutput(stdout)) stdout.removeListener('error', onDestinationError)
  }
}

export function collectCappedStderr(child: ChildProcess, cap: number): { bytes: () => Buffer } {
  let chunks: Buffer[] = []
  let length = 0
  const output = child.stderr
  if (!output) throw new Error('child stderr is not a pipe')
  output.on('data', (chunk: Buffer) => {
    if (length >= cap) return
    const remaining = cap - length
    const slice = chunk.byteLength > remaining ? chunk.subarray(0, remaining) : chunk
    chunks = [...chunks, slice]
    length += slice.byteLength
  })
  return {
    bytes() {
      return Buffer.concat(chunks)
    },
  }
}

export type ChildOutcome =
  | { kind: 'close'; exitCode: number | null; signal: NodeJS.Signals | null }
  | { kind: 'error'; error: Error }

export function waitForChild(child: ChildProcess): Promise<ChildOutcome> {
  return new Promise((resolve) => {
    child.once('error', (err) => {
      resolve({
        kind: 'error',
        error: err,
      })
    })
    child.once('close', (exitCode, signal) => {
      resolve({ kind: 'close', exitCode, signal })
    })
  })
}

export function classifyFailure(input: {
  command: string
  aborted: boolean
  timedOut: boolean
  stdinError: Error | undefined
  stdoutError: Error | undefined
  exitCode: number | null
  signal: NodeJS.Signals | null
  stderr: Buffer
}): CommandFailedError | Error | undefined {
  const details = {
    exitCode: input.exitCode,
    signal: input.signal,
    stderr: input.stderr,
  }
  if (input.aborted) return failure(input.command, 'abort', details)
  if (input.timedOut) return failure(input.command, 'timeout', details)
  if (input.stdoutError) return input.stdoutError
  if (input.stdinError) return input.stdinError
  if (input.signal) return failure(input.command, 'signal', details)
  if (input.exitCode !== 0) return failure(input.command, 'exit', details)
  return undefined
}

function failure(
  command: string,
  reason: CommandFailureReason,
  details: { exitCode: number | null; signal: NodeJS.Signals | null; stderr: Buffer },
): CommandFailedError {
  return new CommandFailedError(command, { reason, ...details })
}
