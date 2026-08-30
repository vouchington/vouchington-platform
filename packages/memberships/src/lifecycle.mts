import type {
  MembershipChangeType,
  MembershipLifecycleFields,
  MembershipLifecycleUpdate,
  MembershipStatus,
} from './types.mts'

export function isTerminalMembershipStatus(status: MembershipStatus): boolean {
  return status === 'cancelled' || status === 'expired'
}

export function transitionMembershipLifecycle(
  current: MembershipLifecycleFields,
  update: MembershipLifecycleUpdate,
  at: Date,
): MembershipLifecycleFields {
  const status = update.status ?? current.status
  if (current.status === 'expired' && status !== 'expired') {
    throw new Error('An expired membership cannot transition to another status')
  }
  const timestamp =
    status === 'active'
      ? null
      : current.status === status
        ? (timestampForStatus(current, status) ?? at)
        : at
  return {
    status,
    cancelledAt: status === 'cancelled' ? timestamp : null,
    expiredAt: status === 'expired' ? timestamp : null,
    pastDueAt: status === 'past_due' ? timestamp : null,
    pausedAt: status === 'paused' ? timestamp : null,
    cancelAtPeriodEnd: isTerminalMembershipStatus(status)
      ? false
      : (update.cancelAtPeriodEnd ?? current.cancelAtPeriodEnd),
  }
}

export function classifyMembershipChange<Plan, Sku>(options: {
  previousStatus: MembershipStatus
  nextStatus: MembershipStatus
  previousPlan: Plan
  nextPlan: Plan
  previousSku: Sku
  nextSku: Sku
  comparePlans: (left: Plan, right: Plan) => number
}): MembershipChangeType | null {
  const { previousStatus, nextStatus, previousPlan, nextPlan, previousSku, nextSku, comparePlans } =
    options
  if (previousPlan !== nextPlan) {
    const comparison = comparePlans(nextPlan, previousPlan)
    if (comparison !== 0) return comparison > 0 ? 'upgrade' : 'downgrade'
  }
  if (previousStatus !== nextStatus) return classifyStatusChange(previousStatus, nextStatus)
  return previousSku !== nextSku ? 'sku_migration' : null
}

function timestampForStatus(
  current: MembershipLifecycleFields,
  status: Exclude<MembershipStatus, 'active'>,
): Date | null {
  switch (status) {
    case 'cancelled':
      return current.cancelledAt
    case 'expired':
      return current.expiredAt
    case 'past_due':
      return current.pastDueAt
    case 'paused':
      return current.pausedAt
  }
}

function classifyStatusChange(
  previous: MembershipStatus,
  next: MembershipStatus,
): MembershipChangeType {
  if (next === 'cancelled') return 'cancellation'
  if (next === 'paused') return 'pause'
  if ((previous === 'cancelled' || previous === 'paused') && next === 'active')
    return 'reactivation'
  return next === 'expired' ? 'expiration' : 'renewal'
}
