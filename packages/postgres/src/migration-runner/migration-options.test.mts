import { describe, expect, it } from 'vitest'

import {
  getMigrationConnectRetry,
  getMigrationTimeouts,
  resolveMigrationTimeouts,
} from './migration-options.mts'

describe('migration options', () => {
  it('reads env defaults and overrides', () => {
    expect(getMigrationTimeouts({})).toEqual({
      lockTimeoutMs: 5_000,
      statementTimeoutMs: 900_000,
    })
    expect(
      getMigrationTimeouts({
        PG_MIGRATION_LOCK_TIMEOUT_MS: '10',
        PG_MIGRATION_STATEMENT_TIMEOUT_MS: '20',
      }),
    ).toEqual({ lockTimeoutMs: 10, statementTimeoutMs: 20 })
    expect(resolveMigrationTimeouts({})).toEqual({
      lockTimeoutMs: 5_000,
      statementTimeoutMs: 900_000,
    })
    expect(
      resolveMigrationTimeouts(
        {},
        { PG_MIGRATION_LOCK_TIMEOUT_MS: '10', PG_MIGRATION_STATEMENT_TIMEOUT_MS: '20' },
      ),
    ).toEqual({ lockTimeoutMs: 10, statementTimeoutMs: 20 })
    expect(() => resolveMigrationTimeouts({ statementTimeoutMs: 0 })).toThrow(
      'statementTimeoutMs must be a positive integer',
    )
  })

  it('rejects invalid values', () => {
    expect(() => getMigrationTimeouts({ PG_MIGRATION_LOCK_TIMEOUT_MS: '0' })).toThrow(
      'positive integer',
    )
    expect(() => resolveMigrationTimeouts({ lockTimeoutMs: 0 })).toThrow(
      'lockTimeoutMs must be a positive integer',
    )
    expect(() => getMigrationConnectRetry({ PG_MIGRATION_CONNECT_RETRY_DELAY_MS: '-1' })).toThrow(
      'non-negative integer',
    )
    expect(getMigrationConnectRetry({})).toEqual({ attempts: 6, delayMs: 5_000 })
  })
})
