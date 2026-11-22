const DEFAULT_ENV_PREFIX = 'WORKER_CONCURRENCY_'
const DEFAULT_MAX = 25

export type GetWorkerConcurrencyOptions = {
  baseline: number
  max?: number
  ignoreScale?: boolean
  env?: NodeJS.ProcessEnv
  /** Prefix of the env vars read for this worker; default `WORKER_CONCURRENCY_`. */
  envPrefix?: string
  /** Env var holding the global scale factor; default `<envPrefix>SCALE`. */
  scaleEnv?: string
  /** Env var holding the global cap; default `<envPrefix>MAX`. */
  maxEnv?: string
}

// Resolves the worker concurrency for `name` using:
// 1. <envPrefix><NAME> override (clamped by max), else
// 2. baseline * <scaleEnv> (skipped when ignoreScale=true)
// then clamped to [1, max] where max = <maxEnv> ?? opts.max ?? 25.
// The env var names default to WORKER_CONCURRENCY_<NAME>, _SCALE, and _MAX.
export function getWorkerConcurrency(name: string, opts: GetWorkerConcurrencyOptions): number {
  assertPositiveInt('baseline', opts.baseline)
  const env = opts.env ?? process.env
  const prefix = opts.envPrefix ?? DEFAULT_ENV_PREFIX
  const max = readPositiveInt(env, opts.maxEnv ?? `${prefix}MAX`) ?? opts.max ?? DEFAULT_MAX
  assertPositiveInt('max', max)
  const override = readPositiveInt(env, `${prefix}${normalizeName(name)}`)
  if (override != null) return Math.min(override, max)
  const scale = opts.ignoreScale
    ? 1
    : (readPositiveFloat(env, opts.scaleEnv ?? `${prefix}SCALE`) ?? 1)
  return Math.min(Math.max(1, Math.round(opts.baseline * scale)), max)
}

// Reads a positive integer from an env var, returning `defaultValue` when unset.
// Throws if the value is set but not a positive integer, so misconfiguration fails loudly.
export function parseEnvPositiveInt(
  name: string,
  defaultValue: number,
  env: NodeJS.ProcessEnv = process.env,
): number {
  assertPositiveInt(`default for ${name}`, defaultValue)
  const value = readPositiveInt(env, name)
  return value ?? defaultValue
}

function readPositiveInt(env: NodeJS.ProcessEnv, name: string): number | null {
  const raw = env[name]
  if (raw == null || raw === '') return null
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`${name} must be a positive integer, got "${raw}"`)
  }
  const value = Number.parseInt(trimmed, 10)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got "${raw}"`)
  }
  return value
}

function readPositiveFloat(env: NodeJS.ProcessEnv, name: string): number | null {
  const raw = env[name]
  if (raw == null || raw === '') return null
  const trimmed = raw.trim()
  const value = Number(trimmed)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number, got "${raw}"`)
  }
  return value
}

function assertPositiveInt(label: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer, got ${value}`)
  }
}

// Worker names like "rssFeedItemCategories" or "ai_agents" both normalize to
// RSS_FEED_ITEM_CATEGORIES / AI_AGENTS so the env prefix matches a single shape.
function normalizeName(name: string): string {
  return name
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replaceAll('-', '_')
    .toUpperCase()
}
