export type MembershipStatus = 'active' | 'past_due' | 'paused' | 'cancelled' | 'expired'

export type MembershipChangeType =
  | 'upgrade'
  | 'downgrade'
  | 'renewal'
  | 'cancellation'
  | 'reactivation'
  | 'pause'
  | 'sku_migration'
  | 'expiration'
