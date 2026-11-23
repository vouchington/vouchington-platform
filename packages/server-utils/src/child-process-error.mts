export type CommandFailureReason = 'exit' | 'signal' | 'abort' | 'timeout'

/** Most stderr bytes included in a failure message; `.stderr` keeps the full captured buffer. */
const MESSAGE_STDERR_TAIL_BYTES = 1_024

interface CommandFailureDetails {
  reason: CommandFailureReason
  exitCode: number | null
  signal: NodeJS.Signals | null
  stderr: Buffer
  /** The timeout that elapsed; set for `reason: 'timeout'`. */
  timeoutMs?: number
}

export class CommandFailedError extends Error {
  readonly command: string
  readonly reason: CommandFailureReason
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
  readonly stderr: Buffer
  declare readonly timeoutMs?: number

  constructor(command: string, details: CommandFailureDetails) {
    super(formatCommandFailure(command, details))
    this.name = 'CommandFailedError'
    this.command = command
    this.reason = details.reason
    this.exitCode = details.exitCode
    this.signal = details.signal
    this.stderr = details.stderr
    if (details.timeoutMs !== undefined) this.timeoutMs = details.timeoutMs
  }
}

function formatCommandFailure(command: string, details: CommandFailureDetails): string {
  const { stderr } = details
  const truncated = stderr.byteLength > MESSAGE_STDERR_TAIL_BYTES
  const tail = truncated ? stderr.subarray(stderr.byteLength - MESSAGE_STDERR_TAIL_BYTES) : stderr
  // Slicing can split a multi-byte character; drop the replacement characters it leaves at the cut.
  const text = tail
    .toString('utf8')
    .replace(/^\uFFFD+/u, '')
    .trim()
  const suffix = text.length > 0 ? `: ${truncated ? '...' : ''}${text}` : ''
  return `command ${details.reason} (${command}) exit=${details.exitCode ?? 'null'} signal=${details.signal ?? 'null'}${suffix}`
}
