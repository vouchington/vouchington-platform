import type { Psql, QueryOptions } from '@vouchington/postgres'

import { assertVoteScore } from './codec.mts'
import { assertSqlIdentifier, assertUuid } from './identifiers.mts'
import { listByEntity, listByUser } from './store-pagination.mts'
import { insertQuery, lockQuery, userVotesQuery } from './vote-queries.mts'
import { toCurrent, toEvent, type EventRow } from './vote-row.mts'
import type {
  CurrentVote,
  VoteAudit,
  VoteEvent,
  VoteInput,
  VoteStore,
  VoteStoreOptions,
} from './types.mts'

export function createVoteStore(psql: Psql, options: VoteStoreOptions): VoteStore {
  const table = assertSqlIdentifier(options.table, 'table')
  const entityIdColumn = assertSqlIdentifier(options.entityIdColumn, 'entityIdColumn')
  const scope = options.cursorScope ?? `${table}:${entityIdColumn}`
  return {
    upsert: (userId, votes, audit = {}, queryOptions = {}) =>
      upsert(psql, table, entityIdColumn, options, userId, votes, audit, queryOptions),
    clear: (userId, entityId, audit = {}, queryOptions = {}) =>
      upsert(
        psql,
        table,
        entityIdColumn,
        options,
        userId,
        [{ entityId, score: null }],
        audit,
        queryOptions,
      ),
    getCurrent: (userId, entityId) => getCurrent(psql, table, entityIdColumn, userId, entityId),
    getByUser: (userId, entityIds) => getByUser(psql, table, entityIdColumn, userId, entityIds),
    listByUser: (userId, page) =>
      listByUser(psql, table, entityIdColumn, `${scope}:by-user:${userId}`, userId, page),
    listByEntity: (entityId, page) =>
      listByEntity(psql, table, entityIdColumn, `${scope}:by-entity:${entityId}`, entityId, page),
    listByUserForEntity: (userId, entityId, page) =>
      listByUser(
        psql,
        table,
        entityIdColumn,
        `${scope}:by-user-entity:${userId}:${entityId}`,
        userId,
        page,
        [entityId],
      ),
  }
}

async function upsert(
  psql: Psql,
  table: string,
  entityIdColumn: string,
  options: VoteStoreOptions,
  userId: string,
  votes: readonly VoteInput[],
  audit: VoteAudit,
  queryOptions: QueryOptions,
): Promise<readonly VoteEvent[]> {
  assertUuid(userId, 'userId')
  const values = normalizeVotes(votes)
  if (values.length === 0) return []
  return psql.withTransactionOptions(queryOptions, async (query) => {
    const userAgentId = audit.userAgent
      ? ((await options.resolveUserAgentId?.(audit.userAgent, query)) ?? null)
      : null
    await query(lockQuery(table, userId, values))
    const { rows } = await query<EventRow>(
      insertQuery(table, entityIdColumn, userId, values, audit, userAgentId),
    )
    return rows.map(toEvent)
  })
}

async function getCurrent(
  psql: Psql,
  table: string,
  entityIdColumn: string,
  userId: string,
  entityId: string,
): Promise<CurrentVote | null> {
  assertUuid(userId, 'userId')
  assertUuid(entityId, 'entityId')
  const { rows } = await psql.write<EventRow>(
    userVotesQuery(table, entityIdColumn, userId, [entityId]),
  )
  return rows[0] ? toCurrent(rows[0]) : null
}

async function getByUser(
  psql: Psql,
  table: string,
  entityIdColumn: string,
  userId: string,
  entityIds?: readonly string[],
): Promise<readonly CurrentVote[]> {
  assertUuid(userId, 'userId')
  entityIds?.forEach((entityId) => assertUuid(entityId, 'entityId'))
  const { rows } = await psql.read<EventRow>(
    userVotesQuery(table, entityIdColumn, userId, entityIds),
  )
  return rows.map(toCurrent)
}

function normalizeVotes(votes: readonly VoteInput[]): VoteInput[] {
  const deduplicated = new Map<string, VoteInput>()
  for (const vote of votes) {
    assertUuid(vote.entityId, 'entityId')
    assertVoteScore(vote.score)
    deduplicated.set(vote.entityId, vote)
  }
  return [...deduplicated.values()].sort((left, right) =>
    left.entityId.localeCompare(right.entityId),
  )
}
