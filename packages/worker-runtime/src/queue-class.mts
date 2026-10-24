import { assertSelectorSafeQueueName } from './selector-names.mts'

export type QueueSelectionEnv = {
  WORKER_QUEUE_CLASS?: string | undefined
  QUEUES?: string | undefined
}

export type WorkerQueueClassErrorCode =
  | 'CONFLICTING_QUEUE_SELECTORS'
  | 'UNSUPPORTED_QUEUE_CLASS'
  | 'UNKNOWN_QUEUE_NAMES'

/** A worker process was configured with a queue selection it must not start with. */
export class WorkerQueueClassError extends Error {
  readonly code: WorkerQueueClassErrorCode

  constructor(code: WorkerQueueClassErrorCode, message: string) {
    super(message)
    this.name = 'WorkerQueueClassError'
    this.code = code
  }
}

export type QueueClassResolver<C extends string = string> = (
  env: QueueSelectionEnv,
  acceptedClasses: readonly C[],
  knownQueueNames: readonly string[],
) => string | undefined

/**
 * Builds a resolver that turns a process's queue selection into one value for every runtime in the
 * process. `WORKER_QUEUE_CLASS` names a class from the injected `policy` (class name to queue
 * names) and expands to an explicit include list, which also reaches explicit-inclusion
 * definitions that an unset selection skips. `QUEUES` is the name-level selector and is returned
 * untouched, but every name it lists (an include `name` or an exclude `-name`) must be in
 * `knownQueueNames`. Blank values count as unset. Setting both selectors, a class the entrypoint
 * does not accept, or an unknown `QUEUES` name throws a `WorkerQueueClassError`.
 */
export function createQueueClassResolver<C extends string>(
  policy: Readonly<Record<C, readonly string[]>>,
): QueueClassResolver<C> {
  const isClass = (value: string): value is C => Object.hasOwn(policy, value)
  for (const [queueClass, names] of Object.entries<readonly string[]>(policy)) {
    // An empty include list would parse as "select everything".
    if (names.length === 0)
      throw new Error(`Queue class "${queueClass}" must list at least one queue`)
    for (const name of names) assertSelectorSafeQueueName(name, `queue class "${queueClass}"`)
  }

  return (env, acceptedClasses, knownQueueNames) => {
    const queueClass = env.WORKER_QUEUE_CLASS?.trim()
    if (!queueClass) return requireKnownQueueNames(env.QUEUES, knownQueueNames)

    if (env.QUEUES?.trim()) {
      throw new WorkerQueueClassError(
        'CONFLICTING_QUEUE_SELECTORS',
        'WORKER_QUEUE_CLASS and QUEUES are mutually exclusive; set only one of them',
      )
    }
    if (!isClass(queueClass) || !acceptedClasses.includes(queueClass)) {
      throw new WorkerQueueClassError(
        'UNSUPPORTED_QUEUE_CLASS',
        `WORKER_QUEUE_CLASS must be one of ${acceptedClasses.join(', ')} for this worker, got "${queueClass}"`,
      )
    }
    return policy[queueClass].join(',')
  }
}

// Names are read the way `parseQueueSelection` reads them: comma-separated, trimmed, with one
// leading `-` marking an exclude. Empty entries and mixed signs are left for that parser to reject.
function requireKnownQueueNames(
  queues: string | undefined,
  knownQueueNames: readonly string[],
): string | undefined {
  const known = new Set(knownQueueNames)
  const unknown = new Set(
    (queues ?? '')
      .split(',')
      .map((entry) => entry.trim().replace(/^-/, ''))
      .filter((name) => name.length > 0 && !known.has(name)),
  )
  if (unknown.size > 0) {
    throw new WorkerQueueClassError(
      'UNKNOWN_QUEUE_NAMES',
      `QUEUES names queues this worker does not run: ${[...unknown].join(', ')}`,
    )
  }
  return queues
}
