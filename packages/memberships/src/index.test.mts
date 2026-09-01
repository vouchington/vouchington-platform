import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  buildMembershipBenefitCatalog,
  classifyMembershipChange,
  groupMembershipSkusByPlan,
  isTerminalMembershipStatus,
  resolveMembershipBenefit,
} from './index.mts'

describe('membership status and changes', () => {
  it('identifies terminal statuses', () => {
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
