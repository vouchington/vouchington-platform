export type CommandFailureReason = 'exit' | 'signal' | 'abort' | 'timeout'

export class CommandFailedError extends Error {
  readonly reason: CommandFailureReason
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
  readonly stderr: Buffer

  constructor(
    command: string,
    details: {
      reason: CommandFailureReason
      exitCode: number | null
      signal: NodeJS.Signals | null
      stderr: Buffer
    },
  ) {
    super(formatCommandFailure(command, details))
    this.name = 'CommandFailedError'
    this.reason = details.reason
    this.exitCode = details.exitCode
    this.signal = details.signal
    this.stderr = details.stderr
  }
}

function formatCommandFailure(
  command: string,
  details: {
    reason: CommandFailureReason
    exitCode: number | null
    signal: NodeJS.Signals | null
    stderr: Buffer
  },
): string {
  const stderrText = details.stderr.toString('utf8').trim()
  const suffix = stderrText.length > 0 ? `: ${stderrText}` : ''
  return `command ${details.reason} (${command}) exit=${details.exitCode ?? 'null'} signal=${details.signal ?? 'null'}${suffix}`
}
