import { describe, expect, it } from 'vitest'

import * as postgres from './index.mts'

describe('package exports', () => {
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
