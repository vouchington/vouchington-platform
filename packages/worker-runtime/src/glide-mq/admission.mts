export type EnqueueAdmission = {
  readonly queue: object
  readonly queueName: string
  readonly jobName: string
  readonly inputs: readonly unknown[]
  readonly completion: Promise<unknown>
  readonly observerErrors: readonly unknown[]
  readonly reportingErrors: readonly unknown[]
}

export type EnqueueAdmissionListener = (event: EnqueueAdmission) => undefined

const listeners = new Set<EnqueueAdmissionListener>()

/** Observes enqueue admissions before callers discard their original promises. */
export function onEnqueueAdmission(listener: EnqueueAdmissionListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Notifies listeners of one admission. A throwing listener is recorded in `observerErrors` and
 * passed to `report`; a throwing `report` is recorded in `reportingErrors`. Publishing never
 * replaces the original enqueue promise or its error handling.
 */
export function publishEnqueueAdmission(
  identity: Pick<EnqueueAdmission, 'queue' | 'queueName' | 'jobName' | 'inputs' | 'completion'>,
  report?: (error: Error) => void,
): void {
  const observerErrors: unknown[] = []
  const reportingErrors: unknown[] = []
  const event: EnqueueAdmission = { ...identity, observerErrors, reportingErrors }
  for (const listener of Array.from(listeners)) {
    try {
      listener(event)
    } catch (error) {
      observerErrors.push(error)
      try {
        report?.(
          error instanceof Error
            ? error
            : new Error('Enqueue admission observer failed', { cause: error }),
        )
      } catch (reportingError) {
        reportingErrors.push(reportingError)
      }
    }
  }
}
