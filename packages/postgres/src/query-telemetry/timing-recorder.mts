import type { QueryTimingHandler, QueryTimingInput } from '../types.mts'

/** Analytics-shaped record built for each sampled query. */
export type QueryTimingRecord = {
  event_id: string
  event_time: Date
  event_date: string
  env: string
  annotation: string
  pool: QueryTimingInput['pool']
  duration_ms: number
  row_count: number
  error: boolean
  cursor_batches?: number
  pipelined?: boolean
  batch_size?: number
}

export interface QueryTimingRecorderOptions {
  /** Receives each sampled record. Never allowed to throw into the query path. */
  emit: (record: QueryTimingRecord) => void
  /** Cheap early-out checked first; defaults to enabled. */
  enabled?: () => boolean
  /** Probability in [0, 1]. A function is read per query. Defaults to 1. */
  sampleRate?: number | (() => number)
  /** Synchronous observers (request profiling) that see every query, sampled or not. */
  observe?: (input: QueryTimingInput) => void
  /** Defaults to `process.env`; only `NODE_ENV` and `VITEST` are read. */
  env?: NodeJS.ProcessEnv
  random?: () => number
  now?: () => Date
  /** Defaults to `process.stderr.write`. */
  writeStderr?: (line: string) => void
  /** Errored test-env queries at or below this are routine (asserted violations). Default 500. */
  slowFailureThresholdMs?: number
}

const DEFAULT_SLOW_FAILURE_THRESHOLD_MS = 500

/**
 * Builds a handler for `createPsql({ onQueryTiming })`. In test environments it names slow
 * errored queries on stderr (the bare timeout error never names the query). Otherwise it samples
 * and emits one record per query. Observer and emitter failures are swallowed by the caller.
 */
export function createQueryTimingRecorder(options: QueryTimingRecorderOptions): QueryTimingHandler {
  const env = options.env ?? process.env
  const threshold = options.slowFailureThresholdMs ?? DEFAULT_SLOW_FAILURE_THRESHOLD_MS
  const write = options.writeStderr ?? ((line: string) => void process.stderr.write(line))
  const random = options.random ?? Math.random
  const now = options.now ?? (() => new Date())
  return (input) => {
    const isTest = env.NODE_ENV === 'test' || Boolean(env.VITEST)
    if (isTest && input.error && input.durationMs > threshold) {
      write(
        `[pg-query-failed] annotation=${input.annotation ?? 'unannotated'} pool=${input.pool} ms=${input.durationMs}\n`,
      )
    }
    options.observe?.(input)
    if (options.enabled && !options.enabled()) return
    const rate =
      typeof options.sampleRate === 'function' ? options.sampleRate() : (options.sampleRate ?? 1)
    if (Number.isFinite(rate) && rate < 1 && (rate <= 0 || random() >= rate)) return
    options.emit(buildRecord(input, env, now()))
  }
}

function buildRecord(input: QueryTimingInput, env: NodeJS.ProcessEnv, at: Date): QueryTimingRecord {
  return {
    event_id: crypto.randomUUID(),
    event_time: at,
    event_date: at.toISOString().slice(0, 10),
    env: env.NODE_ENV ?? 'development',
    annotation: input.annotation || 'unannotated',
    pool: input.pool,
    duration_ms: input.durationMs,
    row_count: input.rowCount,
    error: input.error,
    ...(input.cursorBatches === undefined ? {} : { cursor_batches: input.cursorBatches }),
    ...(input.pipelined === undefined ? {} : { pipelined: input.pipelined }),
    ...(input.batchSize === undefined ? {} : { batch_size: input.batchSize }),
  }
}

/** Parses a `PG_QUERY_TIMING_SAMPLE`-style value: unset, empty or non-finite means every query. */
export function parseQueryTimingSampleRate(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 1
  const rate = Number(raw)
  return Number.isFinite(rate) ? rate : 1
}
