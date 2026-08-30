export type MembershipStatus = 'active' | 'past_due' | 'paused' | 'cancelled' | 'expired'

export type MembershipLifecycleFields = {
  status: MembershipStatus
  cancelledAt: Date | null
  expiredAt: Date | null
  pastDueAt: Date | null
  pausedAt: Date | null
  cancelAtPeriodEnd: boolean
}

export type MembershipLifecycleUpdate = {
  status?: MembershipStatus
  cancelAtPeriodEnd?: boolean
}

export type MembershipChangeType =
  | 'upgrade'
  | 'downgrade'
  | 'renewal'
  | 'cancellation'
  | 'reactivation'
  | 'pause'
  | 'sku_migration'
  | 'expiration'
