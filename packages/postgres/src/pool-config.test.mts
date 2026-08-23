import { describe, expect, it } from 'vitest'
import { getPsqlPoolConfiguration } from './pool-config.mts'

describe('PostgreSQL pool configuration', () => {
  it('uses bounded production defaults', () => {
    const config = getPsqlPoolConfiguration({ NODE_ENV: 'production' })
    expect(config).toMatchObject({
      common: { connectionTimeoutMillis: 5_000, options: '-c jit=off' },
      advisoryLockMax: 4,
      readMax: 20,
      writeMax: 20,
    })
  })

  it('constrains the default advisory-lock pool to a smaller write pool', () => {
    expect(
      getPsqlPoolConfiguration({ NODE_ENV: 'production', PG_WRITE_POOL_MAX: '2' }).advisoryLockMax,
    ).toBe(2)
  })

  it('supports an explicit advisory-lock pool override', () => {
    expect(
      getPsqlPoolConfiguration({
        NODE_ENV: 'production',
        PG_ADVISORY_LOCK_POOL_MAX: '3',
        PG_WRITE_POOL_MAX: '7',
      }).advisoryLockMax,
    ).toBe(3)
  })

  it('supports distinct read and write pool limits', () => {
    const config = getPsqlPoolConfiguration({
      NODE_ENV: 'production',
      PG_CONNECTION_TIMEOUT_MS: '2500',
      PG_READ_POOL_MAX: '12',
      PG_WRITE_POOL_MAX: '7',
    })
    expect(config.common.connectionTimeoutMillis).toBe(2_500)
    expect(config.readMax).toBe(12)
    expect(config.writeMax).toBe(7)
  })

  it('uses PG_POOL_MAX as a compatibility fallback', () => {
    const config = getPsqlPoolConfiguration({ NODE_ENV: 'production', PG_POOL_MAX: '9' })
    expect(config.readMax).toBe(9)
    expect(config.writeMax).toBe(9)
  })

  it('rejects invalid positive integer settings', () => {
    expect(() =>
      getPsqlPoolConfiguration({ NODE_ENV: 'production', PG_READ_POOL_MAX: '0' }),
    ).toThrow('PG_READ_POOL_MAX must be a positive integer')
    expect(() =>
      getPsqlPoolConfiguration({ NODE_ENV: 'production', PG_CONNECTION_TIMEOUT_MS: '1.5' }),
    ).toThrow('PG_CONNECTION_TIMEOUT_MS must be a positive integer')
    expect(() =>
      getPsqlPoolConfiguration({
        NODE_ENV: 'production',
        PG_ADVISORY_LOCK_POOL_MAX: '7',
        PG_WRITE_POOL_MAX: '2',
      }),
    ).toThrow(
      'PG_ADVISORY_LOCK_POOL_MAX must be less than or equal to the write pool max (2), got 7',
    )
  })

  it('keeps the test pool contract isolated from production settings', () => {
    const config = getPsqlPoolConfiguration({
      NODE_ENV: 'test',
      PG_CONNECTION_TIMEOUT_MS: '1',
      PG_READ_POOL_MAX: '2',
      PG_TEST_POOL_MAX: '6',
      PG_WRITE_POOL_MAX: '3',
    })
    expect(config.common).toMatchObject({
      allowExitOnIdle: true,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 100,
      statement_timeout: 0,
      options: '-c jit=off',
    })
    expect(config.readMax).toBe(6)
    expect(config.writeMax).toBe(6)
    expect(config.advisoryLockMax).toBe(4)
  })

  it('rejects an oversized advisory-lock pool in tests', () => {
    expect(() =>
      getPsqlPoolConfiguration({
        NODE_ENV: 'test',
        PG_ADVISORY_LOCK_POOL_MAX: '7',
        PG_TEST_POOL_MAX: '2',
      }),
    ).toThrow(
      'PG_ADVISORY_LOCK_POOL_MAX must be less than or equal to the write pool max (2), got 7',
    )
  })
})
