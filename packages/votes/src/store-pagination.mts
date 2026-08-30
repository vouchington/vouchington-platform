import { buildPageInfo, decodeScopedUuidCursor } from '@vouchington/pagination'
import type { Psql } from '@vouchington/postgres'

import { assertUuid } from './identifiers.mts'
import type { VotePage, VotePageOptions } from './types.mts'
import { entityVotesQuery, userVotesQuery } from './vote-queries.mts'
import { toCurrent, type EventRow } from './vote-row.mts'

export async function listByUser(
  psql: Psql,
  table: string,
  entityIdColumn: string,
  scope: string,
  userId: string,
  page: VotePageOptions,
  entityIds?: readonly string[],
): Promise<VotePage> {
  assertUuid(userId, 'userId')
  entityIds?.forEach((entityId) => assertUuid(entityId, 'entityId'))
  assertPage(page)
  const after = decodeAfter(page.after, scope)
  const { rows } = await psql.read<EventRow>(
    userVotesQuery(table, entityIdColumn, userId, entityIds, after, page.limit + 1),
  )
  return toPage(rows, page.limit, 'entity_id', scope)
}

export async function listByEntity(
  psql: Psql,
  table: string,
  entityIdColumn: string,
  scope: string,
  entityId: string,
  page: VotePageOptions,
): Promise<VotePage> {
  assertUuid(entityId, 'entityId')
  assertPage(page)
  const { rows } = await psql.read<EventRow>(
    entityVotesQuery(
      table,
      entityIdColumn,
      entityId,
      decodeAfter(page.after, scope),
      page.limit + 1,
    ),
  )
  return toPage(rows, page.limit, 'user_id', scope)
}

function assertPage(page: VotePageOptions): void {
  if (!Number.isInteger(page.limit) || page.limit < 1) {
    throw new Error('limit must be a positive integer')
  }
}

function decodeAfter(after: string | undefined, scope: string): string | undefined {
  return after ? decodeScopedUuidCursor(after, scope, 'Invalid vote cursor').id : undefined
}

function toPage(
  rows: readonly EventRow[],
  limit: number,
  column: 'entity_id' | 'user_id',
  scope: string,
): VotePage {
  const hasNextPage = rows.length > limit
  const selected = rows.slice(0, limit)
  return {
    results: selected.map(toCurrent),
    pageInfo: buildPageInfo(selected, {
      hasNextPage,
      getCursor: (row) => ({ id: assertUuid(row[column], `vote ${column}`), scope }),
    }),
  }
}
