import {
  completionAudiences,
  createQueryCompletionAudience,
  errorSummary,
  type QueryCompletion,
} from './completion-audience.mts'
import { isUnannotatedQueryAllowed } from '../prepared-statement-name.mts'
import type { QueryExecutor } from '../types.mts'

export type { QueryCompletion, QueryCompletionListener } from './completion-audience.mts'

export interface QueryCompletionDiagnosticsOptions {
  /** Receives a wrapped error for each diagnostic failure; it never reaches the query path. */
  reportError?: (error: Error) => void
}

/** Normal scoped capture owns diagnostics; callers explicitly drain unfinished work. */
export async function runWithQueryCompletionDiagnostics<Result>(
  handler: (
    context: Pick<
      ReturnType<typeof createQueryCompletionAudience>,
      'subscribe' | 'report' | 'deactivate'
    >,
  ) => Promise<Result>,
  options: QueryCompletionDiagnosticsOptions = {},
) {
  const audience = createQueryCompletionAudience(options.reportError)
  try {
    const result = await completionAudiences.run(audience.scope, () => handler(audience))
    audience.deactivate()
    return {
      result,
      completedTransactions: Object.freeze([...audience.completed]),
      completionDrain: audience.close(),
    }
  } catch (err) {
    void audience.close()
    throw err
  }
}

/** Reports to the active scope, returning false when no scope is capturing. */
export function reportQueryCaptureFailure(reason: unknown): boolean {
  const audience = completionAudiences.getStore()
  if (!audience?.active) return false
  audience.report(reason)
  return true
}

/** Mirrors `executeClientQuery`: a value-free allowed statement runs its positional values. */
function executedValues(input: Parameters<QueryExecutor>[0], values: unknown): readonly unknown[] {
  if (typeof input === 'string') return (values as readonly unknown[] | undefined) ?? []
  const positional =
    isUnannotatedQueryAllowed(input) && input.values.length === 0 && values !== undefined
  return positional ? (values as readonly unknown[]) : (input.values ?? [])
}

function freezeDiagnosticValues(value: unknown): void {
  if (!value || typeof value !== 'object') return
  for (const child of Object.values(value)) freezeDiagnosticValues(child)
  Object.freeze(value)
}

/**
 * Call from a query wrapper with the executor, its arguments and the returned promise. Records
 * settlement of the query for the active scope; a no-op outside one.
 */
export function observeQueryCompletion(
  executor: QueryExecutor,
  args: Parameters<QueryExecutor>,
  promise: ReturnType<QueryExecutor>,
): void {
  const audience = completionAudiences.getStore()
  if (!audience?.active) return
  audience.pending.add(promise)
  let metadata: Omit<QueryCompletion, 'status' | 'reason'> | undefined
  try {
    const [input, values] = args
    metadata = {
      text: typeof input === 'string' ? input : input.text,
      values: Object.freeze([...executedValues(input, values)]),
      executor,
      promise,
    }
  } catch (err) {
    audience.report(err)
  }
  let snapshotValues: readonly unknown[] | undefined
  try {
    if (metadata) {
      snapshotValues = JSON.parse(JSON.stringify(metadata.values)) as unknown[]
      freezeDiagnosticValues(snapshotValues)
    }
  } catch (err) {
    audience.report(err)
  }
  const settled = (status: 'fulfilled' | 'rejected', reason?: unknown): undefined => {
    audience.pending.delete(promise)
    if (!audience.active || !metadata) return undefined
    const event: QueryCompletion =
      status === 'fulfilled' ? { ...metadata, status } : { ...metadata, status, reason }
    if (snapshotValues)
      audience.completed.push(
        Object.freeze({
          text: event.text,
          values: snapshotValues,
          status,
          ...(status === 'rejected' ? { error: errorSummary(reason) } : {}),
        }),
      )
    // oxlint-disable-next-line unicorn/no-useless-spread -- snapshot: listeners may unsubscribe or subscribe mid-dispatch.
    for (const listener of [...audience.listeners]) {
      if (!audience.active || !audience.listeners.has(listener)) continue
      try {
        const returned: unknown = listener(Object.freeze(event))
        if (returned !== undefined) {
          const diagnostic = Promise.resolve(returned).then(undefined, audience.report)
          audience.pending.add(diagnostic)
          void diagnostic.then(() => audience.pending.delete(diagnostic))
        }
      } catch (err) {
        audience.report(err)
      }
    }
    return undefined
  }
  try {
    void promise.then(
      () => settled('fulfilled'),
      (err: unknown) => settled('rejected', err),
    )
  } catch (err) {
    audience.pending.delete(promise)
    audience.report(err)
  }
}
