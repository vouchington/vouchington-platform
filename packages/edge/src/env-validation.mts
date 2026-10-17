import { normalizeAssetOrigin } from './csp.mts'
import { parseSentryDsn } from './sentry-dsn.mts'

export type EnvWarner = (key: string, message: string, level?: 'error' | 'warn') => void

/**
 * Creates a warn-once reporter. Create it at module scope so each isolate logs a given key once
 * instead of on every request.
 */
export function createEnvWarner(
  log: { error: (message: string) => void; warn: (message: string) => void } = console,
): EnvWarner {
  const emitted = new Set<string>()
  return (key, message, level = 'error') => {
    if (emitted.has(key)) return
    emitted.add(key)
    log[level](message)
  }
}

/** Anything truthy other than `false` is production, so ambiguous values fail closed. */
export function isProductionMode(env: { PRODUCTION?: string }): boolean {
  const production = env.PRODUCTION?.toLowerCase()
  return Boolean(production) && production !== 'false'
}

/** True when `PRODUCTION` is set to something other than exactly `true` or `false`. */
export function isProductionValueInvalid(env: { PRODUCTION?: string }): boolean {
  const production = env.PRODUCTION?.toLowerCase()
  return Boolean(production) && production !== 'true' && production !== 'false'
}

export function isSecretValid(value: string | undefined, minLength: number): value is string {
  return value !== undefined && value.length >= minLength
}

export function warnIfProductionValueInvalid(warn: EnvWarner, env: { PRODUCTION?: string }): void {
  if (!isProductionValueInvalid(env)) return
  warn(
    'production-invalid',
    `PRODUCTION is set to '${env.PRODUCTION}' but must be exactly 'true' or 'false'; treating it as production mode so security controls fail closed`,
  )
}

export type SecretRequirement = {
  /** Binding name used in messages and as the warn-once key. */
  name: string
  value: string | undefined
  minLength: number
  /** Appended after the dash when the secret is missing or empty. */
  missingConsequence: string
  /** Appended after the dash when the secret is shorter than `minLength`. */
  shortConsequence?: string
  generateHint?: string
}

/** Warns once when a required secret is absent, or present but too short. */
export function warnIfSecretMisconfigured(warn: EnvWarner, secret: SecretRequirement): void {
  const hint = secret.generateHint ?? 'openssl rand -hex 32'
  if (!secret.value) {
    warn(
      `${secret.name}:missing`,
      `${secret.name} is not set or empty — ${secret.missingConsequence}; generate with: ${hint}`,
    )
  } else if (secret.value.length < secret.minLength) {
    const consequence = secret.shortConsequence ?? secret.missingConsequence
    warn(
      `${secret.name}:short`,
      `${secret.name} is too short (minimum ${secret.minLength} characters) — ${consequence}; generate with: ${hint}`,
    )
  }
}

/** Warns once when an asset-origin binding is set but would be dropped by `normalizeAssetOrigin`. */
export function warnIfAssetOriginInvalid(warn: EnvWarner, name: string, value?: string): void {
  if (value?.trim() && !normalizeAssetOrigin(value)) {
    warn(
      `${name}:invalid`,
      `${name} failed validation and will be ignored in CSP — static assets may be blocked. Value must be a valid https:// origin or http://localhost:<port> for local development.`,
    )
  }
}

/** Warns once when a DSN binding is present but unparseable, or absent while `required`. */
export function warnIfDsnInvalid(
  warn: EnvWarner,
  binding: { name: string; value: string | undefined; required?: boolean },
): void {
  if (parseSentryDsn(binding.value)) return
  if (binding.value === undefined && !binding.required) return
  warn(`${binding.name}:dsn`, `${binding.name} is missing or not a valid Sentry DSN`, 'warn')
}
