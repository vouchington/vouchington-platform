import type { ClaimClock, QueueClaim, QueueClaimAdvisor, QueueClaimDisposition } from './types.mts'

export function isQueueClaimExpired<TItem, TActor>(
  claim: QueueClaim<TItem, TActor>,
  now: Date,
  ttlMs: number,
): boolean {
  validateClock(now, ttlMs)
  validateClaimTimestamps(claim)
  return claim.releasedAt === null && claim.claimedAt.getTime() <= now.getTime() - ttlMs
}

export function getQueueClaimDisposition<TItem, TActor>(
  claim: QueueClaim<TItem, TActor> | null,
  actor: TActor,
  now: Date,
  ttlMs: number,
  sameActor: (left: TActor, right: TActor) => boolean,
): QueueClaimDisposition {
  validateClock(now, ttlMs)
  if (claim === null) return 'available'
  validateClaimTimestamps(claim)
  if (claim.releasedAt !== null) return 'available'
  if (sameActor(claim.heldBy, actor)) return 'renew'
  if (isQueueClaimExpired(claim, now, ttlMs)) return 'takeover'
  return 'held'
}

export function createQueueClaimAdvisor<TItem, TActor>(options: {
  clock: ClaimClock
  ttlMs: number
  sameActor(left: TActor, right: TActor): boolean
}): QueueClaimAdvisor<TItem, TActor> {
  validateClock(options.clock(), options.ttlMs)
  return {
    isExpired: (claim) => isQueueClaimExpired(claim, options.clock(), options.ttlMs),
    disposition: (claim, actor) =>
      getQueueClaimDisposition(claim, actor, options.clock(), options.ttlMs, (left, right) =>
        options.sameActor(left, right),
      ),
  }
}

function validateClock(now: Date, ttlMs: number): void {
  if (!Number.isFinite(now.getTime())) throw new TypeError('clock must return a valid date')
  if (!Number.isFinite(ttlMs) || ttlMs <= 0)
    throw new TypeError('ttlMs must be positive and finite')
}

function validateClaimTimestamps<TItem, TActor>(claim: QueueClaim<TItem, TActor>): void {
  if (!isValidDate(claim.claimedAt)) throw new TypeError('claimedAt must be a valid date')
  if (claim.releasedAt !== null && !isValidDate(claim.releasedAt))
    throw new TypeError('releasedAt must be a valid date')
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime())
}
