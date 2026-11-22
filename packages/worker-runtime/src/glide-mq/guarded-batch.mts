import { BatchError, type JobOptions } from 'glide-mq'

/**
 * The partial results of a batch failure. GlideMQ also accepts an `Error` named `BatchError` from
 * another installed copy of the library, so the check is not limited to `instanceof`.
 */
export function batchResults(err: unknown): unknown[] | null {
  const isBatchError =
    err instanceof BatchError || (err instanceof Error && err.name === 'BatchError')
  const results = (err as { results?: unknown } | null)?.results
  return isBatchError && Array.isArray(results) ? results : null
}

export function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err), { cause: err })
}

export function selfAddError(
  active: { jobId: string; dedupId?: string | undefined },
  queue: string,
  jobName: string,
  opts?: JobOptions,
): Error & { extra: Record<string, unknown> } {
  return Object.assign(new Error(`Job ${active.jobId} tried to add itself to queue ${queue}`), {
    extra: {
      queue,
      jobName,
      jobId: opts?.jobId ?? null,
      dedupId: opts?.deduplication?.id ?? null,
      activeJobId: active.jobId,
      activeDedupId: active.dedupId ?? null,
    },
  })
}
