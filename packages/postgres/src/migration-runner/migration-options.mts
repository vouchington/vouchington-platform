import { nonNegativeInteger, positiveInteger } from '../env-integers.mts'

const defaultMigrationLockTimeoutMs = 5_000
const defaultMigrationStatementTimeoutMs = 900_000
const defaultMigrationConnectRetryAttempts = 6
const defaultMigrationConnectRetryDelayMs = 5_000

export interface MigrationTimeouts {
  lockTimeoutMs: number
  statementTimeoutMs: number
}

export interface MigrationConnectRetry {
  attempts: number
  delayMs: number
}

export function getMigrationTimeouts(env: NodeJS.ProcessEnv = process.env): MigrationTimeouts {
  return {
    lockTimeoutMs: positiveInteger(
      env,
      'PG_MIGRATION_LOCK_TIMEOUT_MS',
      defaultMigrationLockTimeoutMs,
    ),
    statementTimeoutMs: positiveInteger(
      env,
      'PG_MIGRATION_STATEMENT_TIMEOUT_MS',
      defaultMigrationStatementTimeoutMs,
    ),
  }
}

export function resolveMigrationTimeouts(overrides: Partial<MigrationTimeouts>): MigrationTimeouts {
  const defaults = getMigrationTimeouts()
  return {
    lockTimeoutMs: positiveValue(
      'lockTimeoutMs',
      overrides.lockTimeoutMs ?? defaults.lockTimeoutMs,
    ),
    statementTimeoutMs: positiveValue(
      'statementTimeoutMs',
      overrides.statementTimeoutMs ?? defaults.statementTimeoutMs,
    ),
  }
}

export function getMigrationConnectRetry(
  env: NodeJS.ProcessEnv = process.env,
): MigrationConnectRetry {
  return {
    attempts: positiveInteger(
      env,
      'PG_MIGRATION_CONNECT_RETRY_ATTEMPTS',
      defaultMigrationConnectRetryAttempts,
    ),
    delayMs: nonNegativeInteger(
      env,
      'PG_MIGRATION_CONNECT_RETRY_DELAY_MS',
      defaultMigrationConnectRetryDelayMs,
    ),
  }
}

function positiveValue(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}
