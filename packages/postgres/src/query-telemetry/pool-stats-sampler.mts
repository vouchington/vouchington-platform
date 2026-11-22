/** The counters `pg.Pool` exposes. */
export interface SampledPool {
  readonly totalCount: number
  readonly idleCount: number
  readonly waitingCount: number
}

export interface PoolStats {
  /** The key the pool was registered under. */
  pool: string
  total: number
  idle: number
  waiting: number
  max: number
}

export interface PoolStatsSamplerOptions {
  /** Pools to sample, keyed by the name reported in `PoolStats.pool`. */
  pools: Readonly<Record<string, { pool: SampledPool; max: number }>>
  /** Receives one entry per pool per tick. Async rejections and throws go to `reportError`. */
  emit: (stats: readonly PoolStats[], sampledAt: Date) => Promise<void> | void
  /** Defaults to 60 seconds. */
  intervalMs?: number
  /** Receives failures from `emit`; without it they are swallowed so the timer survives. */
  reportError?: (error: Error) => void
  /** Injectable for tests; must return a handle whose `unref` and `dispose` are idempotent. */
  schedule?: (callback: () => void, intervalMs: number) => PoolStatsTimer
}

export interface PoolStatsTimer {
  unref(): void
  dispose(): void
}

export interface PoolStatsSampler extends AsyncDisposable {
  /** Starts the unref'd interval; a second call is a no-op. */
  start(): void
  stop(): void
  /** Takes one sample now and passes it to `emit`. */
  sample(): Promise<void>
}

const DEFAULT_INTERVAL_MS = 60_000

function scheduleInterval(callback: () => void, intervalMs: number): PoolStatsTimer {
  const timer = setInterval(callback, intervalMs)
  return {
    unref() {
      timer.unref()
    },
    dispose() {
      clearInterval(timer)
    },
  }
}

/**
 * Connection accounting is per process, so sample inside each process that owns a pool. Whether to
 * start the sampler at all (for example, only when telemetry is enabled) is the caller's decision.
 */
export function createPoolStatsSampler(options: PoolStatsSamplerOptions): PoolStatsSampler {
  const schedule = options.schedule ?? scheduleInterval
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
  let timer: PoolStatsTimer | null = null

  function report(error: unknown): void {
    options.reportError?.(error instanceof Error ? error : new Error(String(error)))
  }

  async function sample(): Promise<void> {
    const stats = Object.entries(options.pools).map(([pool, { pool: counters, max }]) => ({
      pool,
      total: counters.totalCount,
      idle: counters.idleCount,
      waiting: counters.waitingCount,
      max,
    }))
    try {
      await options.emit(stats, new Date())
    } catch (error) {
      report(error)
    }
  }

  function stop(): void {
    timer?.dispose()
    timer = null
  }

  return {
    start() {
      if (timer) return
      timer = schedule(() => void sample(), intervalMs)
      timer.unref()
    },
    stop,
    sample,
    async [Symbol.asyncDispose]() {
      stop()
    },
  }
}
