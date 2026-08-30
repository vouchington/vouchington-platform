import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPsql, type Psql } from '@vouchington/postgres'
import sql from 'sql-template-strings'

import { createVoteStore } from './index.mts'
import { toCurrent } from './vote-row.mts'

const USER_A = '00000000-0000-7000-8000-000000000001'
const USER_B = '00000000-0000-7000-8000-000000000002'
const ENTITY_A = '00000000-0000-7000-8000-000000000011'
const ENTITY_B = '00000000-0000-7000-8000-000000000012'
const ENTITY_C = '00000000-0000-7000-8000-000000000013'

describe('vote store', () => {
  let psql: Psql
  let receivedQuery: unknown

  beforeAll(async () => {
    psql = await createPsql({
      connectionString:
        process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/postgres',
    })
    await psql.write(
      '/* createVoteTestTable */ DROP TABLE IF EXISTS vote_store_test_agents, vote_store_test_votes',
    )
    await psql.write(
      '/* createVoteTestAgents */ CREATE TABLE vote_store_test_agents (id UUID DEFAULT uuidv7() PRIMARY KEY, value TEXT UNIQUE NOT NULL)',
    )
    await psql.write(
      '/* createVoteTestVotes */ CREATE TABLE vote_store_test_votes (id UUID DEFAULT uuidv7() PRIMARY KEY, user_id UUID NOT NULL, entity_id UUID NOT NULL, score SMALLINT, ip_address INET, device_id UUID, session_id UUID, user_agent_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    )
  })

  afterAll(async () => {
    await psql.write(
      '/* dropVoteTestTable */ DROP TABLE IF EXISTS vote_store_test_agents, vote_store_test_votes',
    )
    await psql.close()
  })

  function store() {
    return createVoteStore(psql, {
      table: 'vote_store_test_votes',
      entityIdColumn: 'entity_id',
      cursorScope: 'test-votes',
      resolveUserAgentId: async (userAgent, query) => {
        receivedQuery = query
        const { rows } = await query<{ id: string }>(
          sql`/* insertVoteTestAgent */ INSERT INTO vote_store_test_agents (value) VALUES (${userAgent}) ON CONFLICT (value) DO UPDATE SET value = EXCLUDED.value RETURNING id`,
        )
        return rows[0]!.id
      },
    })
  }

  it('writes deterministic, audited append-only ballots and suppresses same-score repeats', async () => {
    const votes = store()
    await expect(votes.upsert(USER_A, [])).resolves.toEqual([])
    await expect(votes.upsert('invalid', [])).rejects.toThrow('Invalid userId')
    await expect(votes.upsert(USER_A, [{ entityId: ENTITY_A, score: 1.5 }])).rejects.toThrow(
      'score',
    )
    await expect(votes.upsert(USER_A, [{ entityId: ENTITY_A, score: 32_768 }])).rejects.toThrow(
      'smallint',
    )
    const events = await votes.upsert(
      USER_A.toUpperCase(),
      [
        { entityId: ENTITY_B, score: -1 },
        { entityId: ENTITY_A.toUpperCase(), score: 1 },
        { entityId: ENTITY_A, score: 2 },
      ],
      { ipAddress: '127.0.0.1', deviceId: ENTITY_B, sessionId: ENTITY_C, userAgent: 'test-agent' },
    )
    expect(events.map((event) => [event.entityId, event.score, event.previousScore])).toEqual([
      [ENTITY_A, 2, null],
      [ENTITY_B, -1, null],
    ])
    await expect(votes.upsert(USER_A, [{ entityId: ENTITY_A, score: 2 }])).resolves.toEqual([])
    await expect(
      psql.read(sql`/* auditVoteTestAgent */ SELECT value FROM vote_store_test_agents`),
    ).resolves.toMatchObject({
      rows: [{ value: 'test-agent' }],
    })
  })

  it('uses a supplied transaction for audit resolution and projects current non-clear ballots', async () => {
    const votes = store()
    await psql.withTransaction(async (query) => {
      await votes.upsert(
        USER_B,
        [{ entityId: ENTITY_A, score: 1 }],
        { userAgent: 'transaction-agent' },
        { query },
      )
      expect(receivedQuery).toBe(query)
    })
    await expect(votes.getCurrent(USER_B, ENTITY_A)).resolves.toMatchObject({
      score: 1,
      userId: USER_B,
    })
    await expect(votes.getByUser(USER_B, [ENTITY_A])).resolves.toHaveLength(1)
    await expect(votes.getByUser(USER_B, [])).resolves.toEqual([])
    await expect(votes.clear(USER_B, ENTITY_A)).resolves.toHaveLength(1)
    await expect(votes.getCurrent(USER_B, ENTITY_A)).resolves.toBeNull()
    await expect(votes.getByUser(USER_B)).resolves.toEqual([])
    await expect(votes.getCurrent(USER_B, 'not-a-uuid')).rejects.toThrow('Invalid entityId')
  })

  it('rejects caller transactions with stable snapshots', async () => {
    const votes = store()
    await psql.withTransaction(async (query) => {
      await query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
      await expect(
        votes.upsert(USER_B, [{ entityId: ENTITY_C, score: 1 }], {}, { query }),
      ).rejects.toThrow('READ COMMITTED')
    })
  })

  it('keyset-paginates current votes with scoped camel-case page info', async () => {
    const votes = store()
    await votes.upsert(USER_A, [{ entityId: ENTITY_C, score: 1 }])
    const first = await votes.listByUser(USER_A.toUpperCase(), { limit: 1 })
    expect(first.results).toHaveLength(1)
    expect(first.pageInfo).toMatchObject({
      hasNextPage: true,
      startCursor: expect.any(String),
      endCursor: expect.any(String),
    })
    const next = await votes.listByUser(USER_A, { limit: 10, after: first.pageInfo.endCursor! })
    expect(next.results.map((vote) => vote.entityId)).toEqual([ENTITY_B, ENTITY_C])
    expect(next.pageInfo).toEqual({
      hasNextPage: false,
      startCursor: expect.any(String),
      endCursor: null,
    })
    await expect(votes.listByUser(USER_A, { limit: 1, after: 'bad' })).rejects.toThrow(
      'Invalid vote cursor',
    )
    await expect(votes.listByUser(USER_A, { limit: 1, after: '' })).rejects.toThrow(
      'Invalid vote cursor',
    )
    await expect(votes.listByEntity(ENTITY_A, { limit: 0 })).rejects.toThrow('limit')
    await votes.upsert(USER_B, [{ entityId: ENTITY_A, score: -1 }])
    await expect(votes.listByEntity(ENTITY_A, { limit: 10 })).resolves.toMatchObject({
      results: [expect.objectContaining({ userId: USER_A }), expect.anything()],
    })
    const entityFirst = await votes.listByEntity(ENTITY_A, { limit: 1 })
    await expect(
      votes.listByEntity(ENTITY_A, { limit: 1, after: entityFirst.pageInfo.endCursor! }),
    ).resolves.toMatchObject({ results: [expect.objectContaining({ userId: USER_B })] })
    await expect(
      votes.listByEntity(ENTITY_A, { limit: 1, after: first.pageInfo.endCursor! }),
    ).rejects.toThrow('Invalid vote cursor')
    const single = await votes.listByUserForEntity(USER_A, ENTITY_A, { limit: 10 })
    expect(single.results).toHaveLength(1)
    await expect(
      votes.listByUserForEntity(USER_A, ENTITY_B, {
        limit: 10,
        after: single.pageInfo.startCursor!,
      }),
    ).rejects.toThrow('Invalid vote cursor')
  })

  it('rejects unsafe static identifiers', () => {
    expect(() =>
      createVoteStore(psql, { table: 'vote;drop', entityIdColumn: 'entity_id' }),
    ).toThrow('Invalid table')
    expect(() =>
      createVoteStore(psql, { table: 'vote_store_test_votes', entityIdColumn: 'Entity' }),
    ).toThrow('Invalid entityIdColumn')
    expect(() =>
      createVoteStore(psql, { table: `a${'b'.repeat(63)}`, entityIdColumn: 'entity_id' }),
    ).toThrow('Invalid table')
  })

  it('supports the default scope and an absent user-agent resolver', async () => {
    const votes = createVoteStore(psql, {
      table: 'vote_store_test_votes',
      entityIdColumn: 'entity_id',
    })
    await expect(
      votes.upsert(USER_B, [{ entityId: ENTITY_B, score: 1 }], { userAgent: 'unresolved' }),
    ).resolves.toHaveLength(1)
    await expect(votes.listByUser(USER_B, { limit: 10 })).resolves.toMatchObject({
      results: [expect.objectContaining({ entityId: ENTITY_A }), expect.anything()],
    })
  })

  it('quotes validated PostgreSQL keyword identifiers', async () => {
    await psql.write('/* resetKeywordVoteTest */ DROP TABLE IF EXISTS "order"')
    await psql.write(
      '/* createKeywordVoteTest */ CREATE TABLE "order" (id UUID DEFAULT uuidv7() PRIMARY KEY, user_id UUID NOT NULL, "user" UUID NOT NULL, score SMALLINT, ip_address INET, device_id UUID, session_id UUID, user_agent_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    )
    try {
      const votes = createVoteStore(psql, { table: 'order', entityIdColumn: 'user' })
      await expect(votes.upsert(USER_A, [{ entityId: ENTITY_A, score: 1 }])).resolves.toHaveLength(
        1,
      )
      await expect(votes.getCurrent(USER_A, ENTITY_A)).resolves.toMatchObject({ score: 1 })
    } finally {
      await psql.write('/* dropKeywordVoteTest */ DROP TABLE "order"')
    }
  })

  it('rejects malformed database rows', () => {
    expect(() =>
      toCurrent({
        id: USER_A,
        entity_id: ENTITY_A,
        user_id: USER_B,
        score: 1,
        created_at: 'today' as never,
      }),
    ).toThrow('created_at')
  })
})
