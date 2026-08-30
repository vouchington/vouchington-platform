import sql, { type SQLStatement } from 'sql-template-strings'

import type { VoteAudit, VoteInput } from './types.mts'

export function lockQuery(
  table: string,
  userId: string,
  values: readonly VoteInput[],
): SQLStatement {
  return sql`/* lockVoteMutations */ SELECT pg_advisory_xact_lock(hashtextextended(${table} || ':' || ${userId} || ':' || entity_id::text, 0)) FROM (SELECT unnest(${values.map((value) => value.entityId)}::uuid[]) AS entity_id ORDER BY entity_id) ordered`
}

export function insertQuery(
  table: string,
  column: string,
  userId: string,
  values: readonly VoteInput[],
  audit: VoteAudit,
  userAgentId: string | null | undefined,
): SQLStatement {
  const query = sql`/* upsertVotes */ WITH input_data AS (SELECT * FROM UNNEST(${values.map(() => userId)}::uuid[], ${values.map((value) => value.entityId)}::uuid[], ${values.map((value) => value.score)}::smallint[], ${values.map(() => audit.ipAddress ?? null)}::inet[], ${values.map(() => audit.deviceId ?? null)}::uuid[], ${values.map(() => audit.sessionId ?? null)}::uuid[], ${values.map(() => userAgentId ?? null)}::uuid[]) AS raw(user_id, entity_id, score, ip_address, device_id, session_id, user_agent_id)), previous_votes AS (SELECT DISTINCT ON (`
  query
    .append(column)
    .append(sql`) `)
    .append(column)
    .append(sql` AS entity_id, score AS previous_score FROM `)
    .append(table)
    .append(sql` WHERE user_id = ${userId} AND `)
    .append(column)
    .append(sql` = ANY(${values.map((value) => value.entityId)}::uuid[]) ORDER BY `)
    .append(column)
    .append(sql`, id DESC), inserted AS (INSERT INTO `)
    .append(table)
    .append(sql` (user_id, `)
    .append(column)
    .append(
      sql`, score, ip_address, device_id, session_id, user_agent_id) SELECT user_id, entity_id, score, ip_address, device_id, session_id, user_agent_id FROM input_data LEFT JOIN previous_votes USING (entity_id) WHERE input_data.score IS DISTINCT FROM previous_votes.previous_score RETURNING `,
    )
    .append(column)
    .append(
      sql` AS entity_id, id, user_id, score, created_at) SELECT inserted.*, previous_votes.previous_score FROM inserted LEFT JOIN previous_votes USING (entity_id) ORDER BY entity_id`,
    )
  return query
}

export function userVotesQuery(
  table: string,
  column: string,
  userId: string,
  entityIds?: readonly string[],
  afterEntityId?: string,
  limit?: number,
): SQLStatement {
  const query = sql`/* getVotesByUser */ WITH current_votes AS (SELECT DISTINCT ON (vote_event.`
  query
    .append(column)
    .append(sql`) vote_event.`)
    .append(column)
    .append(
      sql` AS entity_id, vote_event.id, vote_event.user_id, vote_event.score, vote_event.created_at FROM `,
    )
    .append(table)
    .append(sql` AS vote_event WHERE vote_event.user_id = ${userId} AND vote_event.`)
  if (entityIds && entityIds.length > 0) {
    query.append(column).append(sql` = ANY(${entityIds}::uuid[]) AND vote_event.`)
  }
  query.append(column)
  if (afterEntityId) query.append(sql` > ${afterEntityId} AND vote_event.`).append(column)
  query
    .append(sql` IS NOT NULL ORDER BY vote_event.`)
    .append(column)
    .append(
      sql`, vote_event.id DESC) SELECT * FROM current_votes WHERE score IS NOT NULL ORDER BY entity_id`,
    )
  if (limit !== undefined) query.append(sql` LIMIT ${limit}`)
  return query
}

export function entityVotesQuery(
  table: string,
  column: string,
  entityId: string,
  after: string | undefined,
  limit: number,
): SQLStatement {
  const query = sql`/* listCurrentVotes */ WITH current_votes AS (SELECT DISTINCT ON (vote_event.`
  query
    .append('user_id')
    .append(sql`) vote_event.`)
    .append(column)
    .append(
      sql` AS entity_id, vote_event.id, vote_event.user_id, vote_event.score, vote_event.created_at FROM `,
    )
    .append(table)
    .append(sql` AS vote_event WHERE vote_event.`)
    .append(column)
    .append(sql` = ${entityId}`)
  if (after) {
    query.append(sql` AND vote_event.user_id > ${after}`)
  }
  query
    .append(sql` ORDER BY vote_event.user_id`)
    .append(
      sql`, vote_event.id DESC) SELECT * FROM current_votes WHERE score IS NOT NULL ORDER BY `,
    )
    .append('user_id')
    .append(sql` LIMIT ${limit}`)
  return query
}
