import type { MembershipChangeType, MembershipStatus } from './types.mts'

export function isTerminalMembershipStatus(status: MembershipStatus): boolean {
  return status === 'cancelled' || status === 'expired'
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
