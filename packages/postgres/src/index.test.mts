import { describe, expect, it } from 'vitest'

import * as postgres from './index.mts'

describe('package exports', () => {
  it('exposes the missing-checksum error thrown by the public integrity helper', () => {
    expect(() => postgres.assertMigrationChecksumMatches('001.sql', null, 'file-checksum')).toThrow(
      postgres.MigrationChecksumMissingError,
    )
    const error = new postgres.MigrationChecksumMissingError('001.sql')
    expect(error.name).toBe('MigrationChecksumMissingError')
    expect(error.migration).toBe('001.sql')
  })

  it('preserves the public checksum-mismatch error contract', () => {
    expect(() =>
      postgres.assertMigrationChecksumMatches('001.sql', 'recorded-checksum', 'file-checksum'),
    ).toThrow(postgres.MigrationChecksumMismatchError)
    const error = new postgres.MigrationChecksumMismatchError(
      '001.sql',
      'recorded-checksum',
      'file-checksum',
    )
    expect(error.name).toBe('MigrationChecksumMismatchError')
    expect(error.migration).toBe('001.sql')
    expect(error.recordedChecksum).toBe('recorded-checksum')
    expect(error.fileChecksum).toBe('file-checksum')
  })

  it('exports the factory and helpers', () => {
    expect(typeof postgres.createPsql).toBe('function')
    expect(typeof postgres.getPsqlPoolConfiguration).toBe('function')
    expect(typeof postgres.resolveDatabaseConnectionString).toBe('function')
    expect(typeof postgres.sqlAndGroup).toBe('function')
    expect(postgres.PIPELINE_BATCH_MAX).toBe(16)
    expect(typeof postgres.withLibpqCompat).toBe('function')
    expect(typeof postgres.connectWithRetry).toBe('function')
    expect(typeof postgres.assertLeadingQueryAnnotation).toBe('function')
    expect(typeof postgres.runBoundedTransactionWithClient).toBe('function')
    expect(typeof postgres.computeMigrationChecksum).toBe('function')
    expect(typeof postgres.prepareMigration).toBe('function')
    expect(typeof postgres.splitSqlStatements).toBe('function')
    expect(typeof postgres.getFilesFromFolder).toBe('function')
    expect(typeof postgres.Cursor).toBe('function')
    expect(typeof postgres.resolveMigrationTimeouts).toBe('function')
  })
})
