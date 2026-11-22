import type { Job, WorkerOptions } from 'glide-mq'
import { ADMIT_SCHEDULED_RUN_LUA, RELEASE_SCHEDULED_RUN_LUA } from './scheduled-run-scripts.mts'
import { DEFAULT_MAX_STALLED_COUNT } from './stall-budget.mts'

type GlideString = string | Uint8Array

/** The slice of a GlideMQ command client the lease needs. */
export interface ScheduledRunLeaseClient {
  hget(key: string, field: string): Promise<GlideString | null>
  get(key: string): Promise<GlideString | null>
  /** Sets `key` to `value` expiring after `expiryMs` milliseconds. */
  set(key: string, value: string, expiryMs: number): Promise<unknown>
  hincrBy(key: string, field: string, amount: number): Promise<unknown>
  /** Runs one of the exported Lua sources and resolves its reply. */
  runScript(lua: string, keys: string[], args: string[]): Promise<unknown>
}

export interface ScheduledRunLeaseConfig {
  client: ScheduledRunLeaseClient
  /** Key prefix used when the worker options carry none; default `glide`. */
  prefix?: string | undefined
  /** Receives bookkeeping failures; a throwing reporter falls back to `logger.error`. */
  onError?: (error: Error) => void
  /** Default `console`. Event names are stable snake_case strings. */
  logger?: Pick<Console, 'info' | 'warn' | 'error'>
  /** Lock duration when neither the job nor the worker sets one; default 30000. */
  defaultLockDurationMs?: number
  /** Stall limit when the worker sets none; default 2. */
  defaultMaxStalledCount?: number
  /** Job-hash fields recording admitted and skipped ticks. */
  admittedField?: string
  skippedField?: string
  /** Metrics-hash counters for skipped and deferred ticks. */
  skippedMetric?: string
  deferredMetric?: string
}

export type ScheduledRunLeaseOptions = Pick<
  WorkerOptions,
  'lockDuration' | 'maxStalledCount' | 'prefix'
>

/**
 * A null result means this scheduler run was skipped because another run is live. `batch` is the
 * whole batch the job runs in: GlideMQ bounds a batch by its longest job timeout, so the lease
 * must outlive that window rather than the job's own timeout.
 */
export type ScheduledRunLease = (
  queue: string,
  job: Job,
  options: ScheduledRunLeaseOptions,
  batch?: readonly Job[],
) => Promise<(() => Promise<void>) | null>

/**
 * Builds a lease that stops one scheduler's ticks from overlapping. A tick that finds a live
 * holder is counted and skipped (or deferred when it is retained, already admitted work); the
 * decision is made atomically in Lua so a lost reply never double-counts or runs known overlap.
 * Jobs without a `schedulerName` always run.
 */
export function createScheduledRunLease(config: ScheduledRunLeaseConfig): ScheduledRunLease {
  const { client } = config
  const logger = config.logger ?? console
  const admittedField = config.admittedField ?? 'scheduledRunLeaseAdmitted'
  const skippedField = config.skippedField ?? 'scheduledRunLeaseSkipped'
  const skippedMetric = config.skippedMetric ?? 'skipped_overlap'
  const deferredMetric = config.deferredMetric ?? 'deferred_admitted'
  if (admittedField === skippedField) throw new Error('admittedField and skippedField must differ')
  const report = (error: unknown, fallback: string) => {
    try {
      config.onError?.(error instanceof Error ? error : new Error(String(error)))
    } catch (err) {
      logger.error(fallback, err)
    }
  }

  return async (queue, job, options, batch) => {
    if (!job.schedulerName) return async () => {}
    const baseKey = `${options.prefix ?? config.prefix ?? 'glide'}:{${queue}}`
    const scheduler = job.schedulerName
    const key = `${baseKey}:run:${scheduler}`
    // A separate namespace: `:run:<name>:previous` would collide with a scheduler named `<name>:previous`.
    const previousKey = `${baseKey}:run-previous:${scheduler}`
    const release = async () => {
      await client.runScript(RELEASE_SCHEDULED_RUN_LUA, [key, previousKey], [job.id])
    }
    let entry: GlideString | null = null
    try {
      entry = await client.hget(`${baseKey}:schedulers`, scheduler)
    } catch (err) {
      // Scheduler metadata only narrows the lease TTL. Admission must still record a
      // colliding tick while the current holder is live, even if this read fails.
      report(err, 'scheduled_interval_reporting_failed')
    }
    const interval = scheduleInterval(entry)
    const maxStalled =
      options.maxStalledCount ?? config.defaultMaxStalledCount ?? DEFAULT_MAX_STALLED_COUNT
    const runtimeOf = (member: Job) => {
      const lockDuration =
        member.opts.lockDuration ?? options.lockDuration ?? config.defaultLockDurationMs ?? 30_000
      // A timeout of 0 means no timeout in GlideMQ, so it falls back to the lock-based bound.
      return member.opts.timeout || lockDuration * (maxStalled + 1)
    }
    const runtime = Math.max(runtimeOf(job), ...(batch ?? []).map(runtimeOf))
    // SET PX needs a positive integer; a fractional bound rounds up so the lease never shortens.
    const ttl = Math.max(1, Math.ceil(Math.min(runtime, interval ?? runtime)))

    const completeAdmission = async () => {
      try {
        const previous = await client.get(previousKey)
        const previousJobId = previous === null ? null : decodeGlideString(previous)
        if (previousJobId !== null && previousJobId !== job.id)
          logger.warn('overlap_lease_expired', { queue, scheduler, jobId: job.id, previousJobId })
        await client.set(previousKey, job.id, Math.ceil(Math.max(ttl * 2, (interval ?? ttl) * 2)))
        return release
      } catch (err_) {
        try {
          await release()
        } catch (err) {
          // A failed cleanup must not hide the bookkeeping failure that triggered it.
          logger.error('scheduled_lease_bookkeeping_release_failed', err)
        }
        throw err_
      }
    }

    const decision = Number(
      await client.runScript(
        ADMIT_SCHEDULED_RUN_LUA,
        [key, `${baseKey}:job:${job.id}`, `${baseKey}:run-metrics`],
        [job.id, scheduler, admittedField, skippedField, String(ttl), skippedMetric],
      ),
    )
    if (decision === 1 || decision === 2) return completeAdmission()
    if (decision === 4) {
      logger.info('skipped_overlap', { queue, scheduler, jobId: job.id, recovered: true })
      return null // the original collision atomically counted this tick
    }
    if (decision !== 0 && decision !== 3 && decision !== 5)
      throw new Error('Unknown scheduled lease admission result')
    if (decision === 3) {
      try {
        await client.hincrBy(`${baseKey}:run-metrics`, deferredMetric, 1)
      } catch (err) {
        report(err, 'scheduled_overlap_metric_reporting_failed')
      }
      logger.info('deferred_admitted', { queue, scheduler, jobId: job.id })
      // A retained sweep page or retry is already admitted work, not a fresh scheduler tick.
      // Keep its saved cursor by delaying it until the current holder finishes.
      await job.moveToDelayed(Date.now() + Math.min(ttl, 1000))
    }
    if (decision === 5) {
      report(
        new Error(`Scheduled overlap metric increment failed for ${queue}/${scheduler}`),
        'scheduled_overlap_metric_reporting_failed',
      )
    }
    logger.info('skipped_overlap', { queue, scheduler, jobId: job.id })
    return null
  }
}

function scheduleInterval(raw: GlideString | null): number | null {
  if (raw === null) return null
  try {
    const entry = JSON.parse(decodeGlideString(raw)) as {
      every?: number
      nextRun?: number
      lastRun?: number
    }
    if (entry.every && entry.every > 0) return entry.every
    if (entry.nextRun && entry.lastRun && entry.nextRun > entry.lastRun)
      return entry.nextRun - entry.lastRun
  } catch {
    // A malformed scheduler entry cannot leave a run with an unbounded lease.
  }
  return null
}

function decodeGlideString(value: GlideString): string {
  return typeof value === 'string' ? value : Buffer.from(value).toString('utf8')
}
