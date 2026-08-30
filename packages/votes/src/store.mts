import type { Psql, QueryExecutor, QueryOptions } from '@vouchington/postgres'

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

const FIXED_VOTE_COLUMNS = new Set([
  'id',
  'user_id',
  'score',
  'ip_address',
  'device_id',
  'session_id',
  'user_agent_id',
  'created_at',
])

export function createVoteStore(psql: Psql, options: VoteStoreOptions): VoteStore {
  const table = assertSqlIdentifier(options.table, 'table')
  const entityIdColumn = assertEntityIdColumn(options.entityIdColumn)
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
    listByUser: (userId, page) => {
      const safeUserId = assertUuid(userId, 'userId')
      return listByUser(
        psql,
        table,
        entityIdColumn,
        `${scope}:by-user:${safeUserId}`,
        safeUserId,
        page,
      )
    },
    listByEntity: (entityId, page) => {
      const safeEntityId = assertUuid(entityId, 'entityId')
      return listByEntity(
        psql,
        table,
        entityIdColumn,
        `${scope}:by-entity:${safeEntityId}`,
        safeEntityId,
        page,
      )
    },
    listByUserForEntity: (userId, entityId, page) => {
      const safeUserId = assertUuid(userId, 'userId')
      const safeEntityId = assertUuid(entityId, 'entityId')
      return listByUser(
        psql,
        table,
        entityIdColumn,
        `${scope}:by-user-entity:${safeUserId}:${safeEntityId}`,
        safeUserId,
        page,
        [safeEntityId],
      )
    },
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
  const safeUserId = assertUuid(userId, 'userId')
  const values = normalizeVotes(votes)
  if (values.length === 0) return []
  return psql.withTransactionOptions(queryOptions, async (query) => {
    if (queryOptions.query) await assertReadCommitted(query)
    const userAgentId =
      audit.userAgent !== undefined && audit.userAgent !== null
        ? ((await options.resolveUserAgentId?.(audit.userAgent, query)) ?? null)
        : null
    await query(lockQuery(table, safeUserId, values))
    const { rows } = await query<EventRow>(
      insertQuery(table, entityIdColumn, safeUserId, values, audit, userAgentId),
    )
    return rows.map(toEvent)
  })
}

function assertEntityIdColumn(value: string): string {
  const column = assertSqlIdentifier(value, 'entityIdColumn')
  if (FIXED_VOTE_COLUMNS.has(column)) {
    throw new Error(`Invalid entityIdColumn: ${value} collides with a fixed vote column`)
  }
  return column
}

async function assertReadCommitted(query: QueryExecutor): Promise<void> {
  const { rows } = await query<{ transaction_isolation: string }>('SHOW transaction_isolation')
  if (rows[0]?.transaction_isolation !== 'read committed') {
    throw new Error('Vote upserts require a READ COMMITTED transaction')
  }
}

async function getCurrent(
  psql: Psql,
  table: string,
  entityIdColumn: string,
  userId: string,
  entityId: string,
): Promise<CurrentVote | null> {
  const safeUserId = assertUuid(userId, 'userId')
  const safeEntityId = assertUuid(entityId, 'entityId')
  const { rows } = await psql.write<EventRow>(
    userVotesQuery(table, entityIdColumn, safeUserId, [safeEntityId]),
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
  const safeUserId = assertUuid(userId, 'userId')
  if (entityIds?.length === 0) return []
  const safeEntityIds = entityIds?.map((entityId) => assertUuid(entityId, 'entityId'))
  const { rows } = await psql.read<EventRow>(
    userVotesQuery(table, entityIdColumn, safeUserId, safeEntityIds),
  )
  return rows.map(toCurrent)
}

function normalizeVotes(votes: readonly VoteInput[]): VoteInput[] {
  const deduplicated = new Map<string, VoteInput>()
  for (const vote of votes) {
    const entityId = assertUuid(vote.entityId, 'entityId')
    assertVoteScore(vote.score)
    deduplicated.set(entityId, { ...vote, entityId })
  }
  return [...deduplicated.values()].sort((left, right) =>
    left.entityId.localeCompare(right.entityId),
  )
}
