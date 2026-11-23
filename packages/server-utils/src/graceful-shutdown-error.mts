export type ShutdownPhase = 'callbacks' | 'drain' | 'closeResources' | 'flush'

export interface ShutdownErrorDetails {
  /** The original thrown value, kept as-is, including non-Error throws. */
  cause: unknown
  /** Name of the registry resource that failed to close. */
  resource?: string
  /** Shutdown phase the failure happened in. */
  phase?: ShutdownPhase
  /** Signal that started the shutdown. */
  signal?: string
}

/** A shutdown failure with a fixed message; filter on its attributes instead of parsing text. */
export class ShutdownError extends Error {
  declare readonly resource?: string
  declare readonly phase?: ShutdownPhase
  declare readonly signal?: string

  constructor(message: string, details: ShutdownErrorDetails) {
    super(message, { cause: details.cause })
    this.name = 'ShutdownError'
    if (details.resource !== undefined) this.resource = details.resource
    if (details.phase !== undefined) this.phase = details.phase
    if (details.signal !== undefined) this.signal = details.signal
  }
}

/** Resource names carried by `error`, its `cause`, or an `AggregateError` cause's members. */
export function resourcesOf(error: ShutdownError): string[] {
  const nested = error.cause instanceof AggregateError ? error.cause.errors : [error.cause]
  return [error, ...nested].flatMap((candidate) =>
    candidate instanceof ShutdownError && candidate.resource !== undefined
      ? [candidate.resource]
      : [],
  )
}
