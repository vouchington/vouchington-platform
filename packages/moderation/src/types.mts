export interface ReportTarget<TType extends string, TId> {
  type: TType
  id: TId
}

export interface ReportDraft<TType extends string, TId, TReason extends string> {
  target: ReportTarget<TType, TId>
  reason: TReason
  note: string | null
}

export interface ReportSubmission<TType extends string, TId, TReason extends string, TActor> {
  draft: ReportDraft<TType, TId, TReason>
  submittedBy: TActor
}

export interface QueueClaim<TItem, TActor> {
  item: TItem
  heldBy: TActor
  claimedAt: Date
  releasedAt: Date | null
}

export type QueueClaimDisposition = 'available' | 'renew' | 'takeover' | 'held'

export type ClaimClock = () => Date

export type Awaitable<T> = T | PromiseLike<T>

export interface QueueClaimAdvisor<TItem, TActor> {
  isExpired(claim: QueueClaim<TItem, TActor>): boolean
  disposition(claim: QueueClaim<TItem, TActor> | null, actor: TActor): QueueClaimDisposition
}

export type ReportValidationCode =
  | 'invalid_target_type'
  | 'invalid_target_identifier'
  | 'invalid_reason'
  | 'invalid_note'
  | 'note_too_long'

export class ReportValidationError extends Error {
  readonly code: ReportValidationCode

  constructor(code: ReportValidationCode, message: string) {
    super(message)
    this.name = 'ReportValidationError'
    this.code = code
  }
}
