import type { Job } from 'glide-mq'

const RESET = '\x1b[0m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const RED = '\x1b[31m'
const ORANGE = '\x1b[38;5;208m'

const DEFAULT_THRESHOLDS = { yellow: 50, orange: 250, red: 500 }
const MAX_TEXT_LENGTH = 120

export interface WorkerLoggerOptions {
  /** Whether to log at all. Callers decide, typically from a development-only check. */
  enabled: boolean
  /** `'error'` logs only failures; `'info'` also logs completions. Default `'error'`. */
  level?: 'error' | 'info'
  /** Elapsed milliseconds at which timings turn yellow, orange, and red. */
  timingThresholds?: { yellow: number; orange: number; red: number }
  /** Receives each formatted line, newline included. Default `process.stdout.write`. */
  write?: (line: string) => void
}

/** A dev-only, one-line-per-job console logger with timing colors. */
export class WorkerLogger {
  readonly #enabled: boolean
  readonly #level: 'error' | 'info'
  readonly #thresholds: { yellow: number; orange: number; red: number }
  readonly #write: (line: string) => void
  readonly #startTimes = new Map<string, bigint>()

  constructor(options: WorkerLoggerOptions) {
    this.#enabled = options.enabled
    this.#level = options.level ?? 'error'
    this.#thresholds = { ...DEFAULT_THRESHOLDS, ...options.timingThresholds }
    this.#write = options.write ?? ((line) => void process.stdout.write(line))
  }

  isEnabled(): boolean {
    return this.#enabled
  }

  /** Records the start time, even in error-only mode, so failures have accurate timing. */
  onActive(queueName: string, job: Job): void {
    if (!this.#enabled) return
    this.#startTimes.set(`${queueName}:${job.id}`, process.hrtime.bigint())
  }

  onCompleted(queueName: string, job: Job): void {
    if (!this.#enabled) return
    const key = `${queueName}:${job.id}`
    if (this.#level === 'error') {
      this.#startTimes.delete(key)
      return
    }
    const ms = this.#takeElapsedMs(key, job)
    this.#print(`${GREEN} ok${RESET}`, ms, `${queueName}/${job.name}`, formatData(job.data))
  }

  onFailed(queueName: string, job: Job, error: unknown): void {
    if (!this.#enabled) return
    const ms = this.#takeElapsedMs(`${queueName}:${job.id}`, job)
    this.#print(`${RED}ERR${RESET}`, ms, `${queueName}/${job.name}`, formatData(job.data), error)
  }

  #takeElapsedMs(key: string, job: Job): number {
    const startTime = this.#startTimes.get(key)
    this.#startTimes.delete(key)
    if (startTime !== undefined) return Number(process.hrtime.bigint() - startTime) / 1_000_000
    return job.processedOn && job.finishedOn ? job.finishedOn - job.processedOn : 0
  }

  #print(status: string, ms: number, label: string, data: string, error?: unknown): void {
    const timing = this.#colorTiming(ms, `${Math.round(ms)}ms`.padStart(5, ' '))
    const suffix = error === undefined ? '' : ` ${formatError(error)}`
    this.#write(`${status} ${timing} ${label} ${data}${suffix}\n`)
  }

  #colorTiming(ms: number, text: string): string {
    if (ms >= this.#thresholds.red) return `${RED}${text}${RESET}`
    if (ms >= this.#thresholds.orange) return `${ORANGE}${text}${RESET}`
    if (ms >= this.#thresholds.yellow) return `${YELLOW}${text}${RESET}`
    return text
  }
}

const truncate = (text: string): string =>
  text.length > MAX_TEXT_LENGTH ? `${text.slice(0, MAX_TEXT_LENGTH)}...` : text

function formatData(data: unknown): string {
  try {
    const text = JSON.stringify(data)
    return typeof text === 'string' ? truncate(text) : String(text)
  } catch {
    return '[unserializable]'
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    const name = error.name || 'Error'
    return truncate(error.message ? `${name}: ${error.message}` : name)
  }
  if (typeof error === 'string') return truncate(error)
  try {
    return truncate(String(error))
  } catch {
    return '[unformattable error]'
  }
}
