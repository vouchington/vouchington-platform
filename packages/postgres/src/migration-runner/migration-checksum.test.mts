import { describe, expect, it } from 'vitest'

import {
  assertMigrationChecksumMatches,
  computeMigrationChecksum,
  MigrationChecksumMismatchError,
} from './migration-checksum.mts'

describe('migration checksums', () => {
  it('hashes SQL and allows a one-time null ledger value', () => {
    const checksum = computeMigrationChecksum('SELECT 1;')
    expect(checksum).toHaveLength(64)
    expect(() => assertMigrationChecksumMatches('001.sql', null, checksum)).not.toThrow()
    expect(() => assertMigrationChecksumMatches('001.sql', checksum, checksum)).not.toThrow()
  })

  it('throws when the file was edited after apply', () => {
    expect(() => assertMigrationChecksumMatches('001.sql', 'abc', 'def')).toThrow(
      MigrationChecksumMismatchError,
    )
    try {
      assertMigrationChecksumMatches('001.sql', 'abc', 'def')
    } catch (error) {
      expect(error).toMatchObject({
        migration: '001.sql',
        recordedChecksum: 'abc',
        fileChecksum: 'def',
        name: 'MigrationChecksumMismatchError',
      })
    }
  })
})
