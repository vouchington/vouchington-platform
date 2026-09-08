import { beforeAll, describe, expect, it } from 'vitest'

import {
  hasUnprovableIndexClause,
  OnlineIndexConflictError,
  requireIndexName,
} from './online-index-errors.mts'
import { parseIndex, recoverOnlineIndex, relationName } from './online-index-recovery.mts'
import { loadSqlParserModule } from './sql-statements.mts'

const sql = 'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx ON widgets (id)'
const definition = 'CREATE INDEX idx ON public.widgets USING btree (id)'

describe('online index recovery decisions', () => {
  beforeAll(loadSqlParserModule)

  it('formats absent error context and accepts an empty clause shape', () => {
    const error = new OnlineIndexConflictError('missing context')
    expect(error.message).toContain('migration=<unknown> table=<unknown> index=<unknown>')
    expect(error.migration).toBe('<unknown>')
    expect(error.table).toBe('<unknown>')
    expect(error.index).toBe('<unknown>')
    expect(hasUnprovableIndexClause({})).toBe(false)
    try {
      requireIndexName({}, { migration: '001-index.sql', table: 'widgets' })
    } catch (error) {
      expect(error).toMatchObject({
        migration: '001-index.sql',
        table: 'widgets',
        index: '<unknown>',
      })
    }
  })

  it('rejects non-replay-safe SQL and invalid target shapes', () => {
    for (const invalid of [
      'CREATE INDEX idx ON widgets (id)',
      'CREATE INDEX CONCURRENTLY idx ON widgets (id)',
    ]) {
      expect(() => parseIndex('001-index.sql', invalid)).toThrow('replay-safe')
    }
    expect(() => relationName('001-index.sql', {})).toThrow('target relation name is not provable')
  })

  it.each(['active', 'non-live'] as const)(
    'does not touch an unsafe %s invalid index',
    async (state) => {
      const calls: string[] = []
      const client = fakeClient(calls, [
        { rows: [{ oid: 42, nspname: 'public', relname: 'widgets' }] },
        { rows: [indexRow(state)] },
      ])
      await expect(recoverOnlineIndex(client, '001-index.sql', sql)).rejects.toMatchObject({
        migration: '001-index.sql',
        table: 'widgets',
        index: 'idx',
        reason: 'existing index is unsafe to repair',
      })
      expect(calls).toHaveLength(2)
      expect(calls.some((query) => /DROP|CREATE INDEX CONCURRENTLY/i.test(query))).toBe(false)
    },
  )

  it('fails post-create verification without a ledger write', async () => {
    const calls: string[] = []
    const client = fakeClient(calls, [
      { rows: [{ oid: 42, nspname: 'public', relname: 'widgets' }] },
      { rows: [] },
      { rows: [] },
    ])
    await expect(recoverOnlineIndex(client, '001-index.sql', sql)).rejects.toMatchObject({
      migration: '001-index.sql',
      table: 'widgets',
      index: 'idx',
      reason: 'post-create catalog verification failed',
    })
    expect(calls).toHaveLength(4)
    expect(calls[2]).toBe(sql)
    expect(calls.some((query) => query.includes('INSERT INTO migrations'))).toBe(false)
  })

  it.each([
    [
      'malformed catalog definition',
      { ...indexRow('active'), active: false, definition: 'not sql' },
      'existing index definition does not exactly match the requested definition',
    ],
    [
      'non-index collision',
      { ...indexRow('active'), active: false, relkind: 'r' },
      'same-schema name belongs to a non-index relation',
    ],
  ])('does not touch a %s', async (_name, row, reason) => {
    const calls: string[] = []
    const client = fakeClient(calls, [
      { rows: [{ oid: 42, nspname: 'public', relname: 'widgets' }] },
      { rows: [row] },
    ])
    await expect(recoverOnlineIndex(client, '001-index.sql', sql)).rejects.toMatchObject({ reason })
    expect(calls).toHaveLength(2)
    expect(calls.some((query) => /DROP|CREATE INDEX CONCURRENTLY/i.test(query))).toBe(false)
  })
})

function fakeClient(calls: string[], replies: { rows: unknown[] }[]) {
  return {
    query: async (query: string) => {
      calls.push(query)
      return replies.shift() ?? { rows: [] }
    },
  } as never
}

function indexRow(state: 'active' | 'non-live') {
  return {
    definition,
    indisprimary: false,
    indisready: false,
    indisvalid: false,
    indislive: state !== 'non-live',
    indisexclusion: false,
    indisreplident: false,
    relispartition: false,
    relkind: 'i',
    constrained: false,
    extension_owned: false,
    active: state === 'active',
    target_match: true,
  }
}
