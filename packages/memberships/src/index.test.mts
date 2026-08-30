import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  buildMembershipBenefitCatalog,
  classifyMembershipChange,
  groupMembershipSkusByPlan,
  isTerminalMembershipStatus,
  resolveMembershipBenefit,
  transitionMembershipLifecycle,
} from './index.mts'
import type {
  CancelSubscriptionCapability,
  CreateSubscriptionCapability,
  ListRefundablePaymentsCapability,
  MembershipLifecycleFields,
  NormalizeWebhookCapability,
  RefundPaymentCapability,
  UpdateSubscriptionCapability,
} from './index.mts'

const active: MembershipLifecycleFields = {
  status: 'active',
  cancelledAt: null,
  expiredAt: null,
  pastDueAt: null,
  pausedAt: null,
  cancelAtPeriodEnd: true,
}

describe('membership lifecycle', () => {
  it('projects every lifecycle state and clears incompatible fields', () => {
    const at = new Date('2026-01-02T03:04:05Z')
    expect(transitionMembershipLifecycle(active, { status: 'past_due' }, at)).toEqual({
      ...active,
      status: 'past_due',
      pastDueAt: at,
    })
    expect(transitionMembershipLifecycle(active, { status: 'paused' }, at).pausedAt).toBe(at)
    expect(transitionMembershipLifecycle(active, { status: 'cancelled' }, at)).toMatchObject({
      cancelledAt: at,
      cancelAtPeriodEnd: false,
    })
    expect(transitionMembershipLifecycle(active, { status: 'expired' }, at)).toMatchObject({
      expiredAt: at,
      cancelAtPeriodEnd: false,
    })
    expect(
      transitionMembershipLifecycle(
        { ...active, status: 'past_due', pastDueAt: at },
        { status: 'active' },
        at,
      ),
    ).toEqual({ ...active, cancelAtPeriodEnd: true })
  })

  it('preserves repeated-state timestamps and rejects expired resurrection', () => {
    const at = new Date('2026-01-02T03:04:05Z')
    const later = new Date('2026-02-02T03:04:05Z')
    const paused = { ...active, status: 'paused' as const, pausedAt: at }
    expect(transitionMembershipLifecycle(paused, { status: 'paused' }, later).pausedAt).toBe(at)
    expect(
      transitionMembershipLifecycle(
        { ...active, status: 'cancelled', cancelledAt: at },
        { status: 'cancelled' },
        later,
      ).cancelledAt,
    ).toBe(at)
    expect(
      transitionMembershipLifecycle(
        { ...active, status: 'expired', expiredAt: at },
        { status: 'expired' },
        later,
      ).expiredAt,
    ).toBe(at)
    expect(
      transitionMembershipLifecycle(
        { ...active, status: 'past_due', pastDueAt: at },
        { status: 'past_due' },
        later,
      ).pastDueAt,
    ).toBe(at)
    expect(
      transitionMembershipLifecycle(
        { ...active, status: 'past_due', pastDueAt: null },
        { status: 'past_due' },
        later,
      ).pastDueAt,
    ).toBe(later)
    expect(transitionMembershipLifecycle(active, { status: 'active' }, later).status).toBe('active')
    expect(
      transitionMembershipLifecycle(
        { ...active, cancelAtPeriodEnd: false },
        { cancelAtPeriodEnd: true },
        later,
      ).cancelAtPeriodEnd,
    ).toBe(true)
    expect(() =>
      transitionMembershipLifecycle(
        { ...active, status: 'expired', expiredAt: at },
        { status: 'active' },
        later,
      ),
    ).toThrow('expired membership')
    expect(() =>
      transitionMembershipLifecycle(
        { ...active, status: 'expired', expiredAt: at },
        { status: 'cancelled' },
        later,
      ),
    ).toThrow('expired membership')
    expect(isTerminalMembershipStatus('cancelled')).toBe(true)
    expect(isTerminalMembershipStatus('expired')).toBe(true)
    expect(isTerminalMembershipStatus('active')).toBe(false)
  })

  it('classifies plan, lifecycle, and SKU changes with caller plan ordering', () => {
    const comparePlans = (left: string, right: string) => left.localeCompare(right)
    const change = (
      overrides: Partial<Parameters<typeof classifyMembershipChange<string, string>>[0]>,
    ) =>
      classifyMembershipChange({
        previousStatus: 'active',
        nextStatus: 'active',
        previousPlan: 'basic',
        nextPlan: 'basic',
        previousSku: 'a',
        nextSku: 'a',
        comparePlans,
        ...overrides,
      })
    expect(change({ nextPlan: 'premium' })).toBe('upgrade')
    expect(change({ previousPlan: 'premium' })).toBe('downgrade')
    expect(change({ nextPlan: 'equivalent', nextSku: 'b', comparePlans: () => 0 })).toBe(
      'sku_migration',
    )
    expect(change({ nextStatus: 'cancelled' })).toBe('cancellation')
    expect(change({ nextStatus: 'paused' })).toBe('pause')
    expect(change({ previousStatus: 'paused', nextStatus: 'active' })).toBe('reactivation')
    expect(change({ previousStatus: 'cancelled', nextStatus: 'active' })).toBe('reactivation')
    expect(change({ nextStatus: 'expired' })).toBe('expiration')
    expect(change({ nextStatus: 'past_due' })).toBe('renewal')
    expect(change({ nextSku: 'b' })).toBe('sku_migration')
    expect(change({})).toBeNull()
  })
})

describe('SKU grouping and generic catalogs', () => {
  it('groups caller-owned SKUs without filtering or copying them', () => {
    const retired = { plan: 'basic', id: 'old', retiredAt: new Date() }
    const current = { plan: 'basic', id: 'current' }
    const grouped = groupMembershipSkusByPlan([retired, { plan: 'premium', id: 'new' }, current])
    expect(grouped.get('basic')).toEqual([retired, current])
    expect(grouped.get('basic')![0]).toBe(retired)
  })

  it('preserves catalog literals and rejects invalid catalog policy', () => {
    const input = {
      version: 1,
      plans: ['basic', 'premium'] as const,
      groups: [
        {
          id: 'usage',
          benefits: [
            { id: 'requests', placements: ['card'] as const, values: { basic: 10, premium: 100 } },
          ],
        },
      ],
    } as const
    const catalog = buildMembershipBenefitCatalog(input, new Set(['requests'] as const))
    expectTypeOf(resolveMembershipBenefit(catalog, 'requests', 'premium')).toEqualTypeOf<
      100 | undefined
    >()
    expect(resolveMembershipBenefit(catalog, 'requests', 'premium')).toBe(100)
    expect(resolveMembershipBenefit(catalog, 'missing' as never, 'basic')).toBeUndefined()
    expect(() => buildMembershipBenefitCatalog(input, new Set())).toThrow('not enforced')
    expect(() =>
      buildMembershipBenefitCatalog(
        { ...input, plans: ['basic', 'missing'] },
        new Set(['requests']),
      ),
    ).toThrow('missing a value')
    expect(() =>
      buildMembershipBenefitCatalog(
        { ...input, plans: ['basic', 'toString'] },
        new Set(['requests']),
      ),
    ).toThrow('missing a value')
    expect(resolveMembershipBenefit(input, 'requests', 'toString' as never)).toBeUndefined()
    expect(() =>
      buildMembershipBenefitCatalog(
        { ...input, groups: [...input.groups, ...input.groups] },
        new Set(['requests']),
      ),
    ).toThrow('Duplicate membership benefit group')
    expect(() =>
      buildMembershipBenefitCatalog(
        {
          ...input,
          groups: [
            {
              ...input.groups[0]!,
              benefits: [...input.groups[0]!.benefits, ...input.groups[0]!.benefits],
            },
          ],
        },
        new Set(['requests']),
      ),
    ).toThrow('Duplicate membership benefit')
  })
})

describe('provider capability contracts', () => {
  it('accepts a non-processor adapter with opaque caller request and result types', async () => {
    const create: CreateSubscriptionCapability<
      { tenant: string },
      { price: string },
      { id: string }
    > = {
      createSubscription: async (_context, request) => ({ id: request.price }),
    }
    const webhook: NormalizeWebhookCapability<{}, Uint8Array, string> = {
      normalizeWebhook: async () => ({
        kind: 'subscription',
        eventId: 'event',
        occurredAt: new Date(),
        subscriptionId: 'sub',
        customerId: null,
        skuId: null,
        status: 'active',
        periodEndAt: null,
        cancelAtPeriodEnd: false,
      }),
    }
    const update: UpdateSubscriptionCapability<{}, { subscription: string }, { id: string }> = {
      updateSubscription: async (_context, request) => ({ id: request.subscription }),
    }
    const cancel: CancelSubscriptionCapability<{}, { subscription: string }, null> = {
      cancelSubscription: async () => null,
    }
    const list: ListRefundablePaymentsCapability<{}, { subscription: string }> = {
      listRefundablePayments: async () => [
        {
          paymentId: 'payment',
          amount: { amountMinorUnits: 100, currency: 'usd' },
          refundedAmount: { amountMinorUnits: 0, currency: 'usd' },
          createdAt: new Date('2026-01-01T00:00:00Z'),
          description: null,
        },
      ],
    }
    const refund: RefundPaymentCapability<{}, { payment: string }, { refunded: boolean }> = {
      refundPayment: async () => ({ refunded: true }),
    }
    await expect(
      create.createSubscription({ tenant: 'a' }, { price: 'p' }, { idempotencyKey: 'key' }),
    ).resolves.toEqual({ id: 'p' })
    await expect(webhook.normalizeWebhook({}, new Uint8Array())).resolves.toMatchObject({
      kind: 'subscription',
    })
    await expect(
      update.updateSubscription({}, { subscription: 'sub' }, { idempotencyKey: 'update-key' }),
    ).resolves.toEqual({ id: 'sub' })
    await expect(
      cancel.cancelSubscription({}, { subscription: 'sub' }, { idempotencyKey: 'cancel-key' }),
    ).resolves.toBeNull()
    await expect(list.listRefundablePayments({}, { subscription: 'sub' })).resolves.toHaveLength(1)
    await expect(
      refund.refundPayment({}, { payment: 'payment' }, { idempotencyKey: 'key' }),
    ).resolves.toEqual({ refunded: true })
  })
})
