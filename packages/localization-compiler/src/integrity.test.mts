import { describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { assertSqliteIntegrity } from './integrity.mts'

describe('sqlite integrity', () => {
  it('rejects artifacts whose integrity_check is not ok', () => {
    const sqlite = {
      prepare() {
        return { get: () => ({ integrity_check: '*** in database main ***' }) }
      },
    } as unknown as DatabaseSync
    expect(() => assertSqliteIntegrity(sqlite)).toThrow(/integrity_check failed/)
  })
})
