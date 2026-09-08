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

  it('does not touch an unresolved target relation', async () => {
    const calls: string[] = []
    await expect(
      recoverOnlineIndex(fakeClient(calls, [{ rows: [] }]), '001-index.sql', sql),
    ).rejects.toMatchObject({
      reason: 'target relation does not resolve',
      migration: '001-index.sql',
      table: '<unknown>',
      index: '<unknown>',
    })
    expect(calls).toHaveLength(1)
    expect(calls.some((query) => /DROP|CREATE INDEX CONCURRENTLY/i.test(query))).toBe(false)
  })

  it('fails closed when predicate statement bounds are ambiguous', async () => {
    const calls: string[] = []
    const predicateSql = `${sql} WHERE id > 0; SELECT 1`
    await expect(
      recoverOnlineIndex(
        fakeClient(calls, [{ rows: [{ oid: 42, nspname: 'public', relname: 'widgets' }] }]),
        '001-index.sql',
        predicateSql,
      ),
    ).rejects.toMatchObject({ reason: 'predicate source is not provable' })
    expect(calls).toHaveLength(1)
  })

  it('propagates predicate catalog query failures', async () => {
    const calls: string[] = []
    const failure = new Error('catalog unavailable')
    const row = {
      ...indexRow('active'),
      active: false,
      definition: `${definition} WHERE (id > 0)`,
      indisready: true,
      indisvalid: true,
      predicate: '(id > 0)',
    }
    const client = fakeClient(calls, [
      { rows: [{ oid: 42, nspname: 'public', relname: 'widgets' }] },
      { rows: [row] },
      { rows: [] },
      failure,
      { rows: [] },
    ])
    await expect(recoverOnlineIndex(client, '001-index.sql', `${sql} WHERE id > 0`)).rejects.toBe(
      failure,
    )
    expect(calls.at(-1)).toBe('ROLLBACK')
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

function fakeClient(calls: string[], replies: ({ rows: unknown[] } | Error)[]) {
  return {
    query: async (query: string) => {
      calls.push(query)
      if (query.startsWith('SAVEPOINT'))
        throw Object.assign(new Error('no active transaction'), { code: '25P01' })
      const reply = replies.shift()
      if (reply instanceof Error) throw reply
      return reply ?? { rows: [] }
    },
  } as never
}

function indexRow(state: 'active' | 'non-live') {
  return {
    definition,
    predicate: null,
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
