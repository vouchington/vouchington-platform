import { assertVoteScore } from './codec.mts'
import { assertUuid } from './identifiers.mts'
import type { CurrentVote, VoteEvent } from './types.mts'

export type EventRow = {
  readonly id: string
  readonly entity_id: string
  readonly user_id: string
  readonly score: number | null
  readonly previous_score?: number | null
  readonly created_at: Date
}

export function toEvent(row: EventRow): VoteEvent {
  return { ...toCurrent(row), previousScore: row.previous_score ?? null }
}

export function toCurrent(row: EventRow): CurrentVote {
  assertUuid(row.id, 'vote id')
  assertUuid(row.entity_id, 'vote entity_id')
  assertUuid(row.user_id, 'vote user_id')
  if (!(row.created_at instanceof Date)) {
    throw new Error('Vote query returned an invalid created_at')
  }
  assertVoteScore(row.score)
  return {
    id: row.id,
    entityId: row.entity_id,
    userId: row.user_id,
    score: row.score,
    createdAt: row.created_at,
  }
}
