import type { PoolConfig } from 'pg'

import { positiveInteger } from './env-integers.mts'

const DEFAULT_POOL_MAX = 20
const DEFAULT_CONNECTION_TIMEOUT_MS = 5_000
const DEFAULT_ADVISORY_LOCK_POOL_MAX = 4

export interface PsqlPoolConfiguration {
  common: PoolConfig & { allowExitOnIdle?: boolean }
  advisoryLockMax: number
  readMax: number
  writeMax: number
}

export function getPsqlPoolConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): PsqlPoolConfiguration {
  if (env.NODE_ENV === 'test') {
    const max = positiveInteger(env, 'PG_TEST_POOL_MAX', DEFAULT_POOL_MAX)
    const advisoryLockMax = positiveInteger(
      env,
      'PG_ADVISORY_LOCK_POOL_MAX',
      Math.min(DEFAULT_ADVISORY_LOCK_POOL_MAX, max),
    )
    assertAdvisoryLockMax(advisoryLockMax, max)
    return {
      common: {
        allowExitOnIdle: true,
        connectionTimeoutMillis: 10_000,
        idle_in_transaction_session_timeout: 0,
        idleTimeoutMillis: 100,
        options: '-c jit=off',
        statement_timeout: 0,
      },
      advisoryLockMax,
      readMax: max,
      writeMax: max,
    }
  }

  const compatibilityMax = positiveInteger(env, 'PG_POOL_MAX', DEFAULT_POOL_MAX)
  const readMax = positiveInteger(env, 'PG_READ_POOL_MAX', compatibilityMax)
  const writeMax = positiveInteger(env, 'PG_WRITE_POOL_MAX', compatibilityMax)
  const advisoryLockMax = positiveInteger(
    env,
    'PG_ADVISORY_LOCK_POOL_MAX',
    Math.min(DEFAULT_ADVISORY_LOCK_POOL_MAX, writeMax),
  )
  assertAdvisoryLockMax(advisoryLockMax, writeMax)
  return {
    common: {
      connectionTimeoutMillis: positiveInteger(
        env,
        'PG_CONNECTION_TIMEOUT_MS',
        DEFAULT_CONNECTION_TIMEOUT_MS,
      ),
      idle_in_transaction_session_timeout: 10_000,
      idleTimeoutMillis: 30_000,
      options: '-c jit=off',
      statement_timeout: 30_000,
    },
    advisoryLockMax,
    readMax,
    writeMax,
  }
}

function assertAdvisoryLockMax(advisoryLockMax: number, writeMax: number): void {
  if (advisoryLockMax > writeMax) {
    throw new Error(
      `PG_ADVISORY_LOCK_POOL_MAX must be less than or equal to the write pool max (${writeMax}), got ${advisoryLockMax}`,
    )
  }
}
