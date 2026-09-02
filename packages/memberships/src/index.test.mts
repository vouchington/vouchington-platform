import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import {
  buildMembershipBenefitCatalog,
  classifyMembershipChange,
  dedupeMembershipOffersByProduct,
  groupMembershipOffersByProduct,
  groupMembershipSkusByPlan,
  isTerminalMembershipStatus,
  resolveMembershipBenefit,
  selectMembershipOffer,
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

describe('membership offer selection', () => {
  type Offer = {
    id: string
    product: string
    interval: 'month' | 'year'
    currency: 'cad' | 'eur' | 'usd'
    revision: number
  }

  const selection = {
    interval: 'month' as const,
    preferredCurrency: 'cad' as const,
    getInterval: (offer: Offer) => offer.interval,
    getCurrency: (offer: Offer) => offer.currency,
    getIdentity: (offer: Offer) => offer.revision,
    compareIdentity: (left: number, right: number) => left - right,
  }

  it('selects the newest preferred-currency offer for the requested interval', () => {
    const offers: Offer[] = [
      { id: 'usd-new', product: 'basic', interval: 'month', currency: 'usd', revision: 3 },
      { id: 'cad-old', product: 'basic', interval: 'month', currency: 'cad', revision: 1 },
      { id: 'cad-new', product: 'basic', interval: 'month', currency: 'cad', revision: 2 },
      { id: 'usd-latest', product: 'basic', interval: 'month', currency: 'usd', revision: 4 },
      { id: 'yearly', product: 'basic', interval: 'year', currency: 'cad', revision: 4 },
    ]

    expect(selectMembershipOffer(offers, selection)).toBe(offers[2])
  })

  it('falls back to the newest interval match when the preferred currency is unavailable', () => {
    const offers: Offer[] = [
      { id: 'usd-old', product: 'basic', interval: 'month', currency: 'usd', revision: 1 },
      { id: 'eur-new', product: 'basic', interval: 'month', currency: 'eur', revision: 2 },
      { id: 'yearly', product: 'basic', interval: 'year', currency: 'cad', revision: 3 },
    ]

    expect(selectMembershipOffer(offers, selection)).toBe(offers[1])
    expect(selectMembershipOffer([], selection)).toBeUndefined()
  })

  it('keeps the first offer when stable identities compare equally', () => {
    const first: Offer = {
      id: 'first',
      product: 'basic',
      interval: 'month',
      currency: 'cad',
      revision: 1,
    }
    const equallyNew = { ...first, id: 'second' }

    expect(selectMembershipOffer([first, equallyNew], selection)).toBe(first)
  })

  it('reads each offer identity once while choosing the newest match', () => {
    const offers: Offer[] = [
      { id: 'newest', product: 'basic', interval: 'month', currency: 'cad', revision: 3 },
      { id: 'older', product: 'basic', interval: 'month', currency: 'cad', revision: 2 },
      { id: 'oldest', product: 'basic', interval: 'month', currency: 'cad', revision: 1 },
    ]
    const getIdentity = vi.fn((offer: Offer) => offer.revision)

    expect(selectMembershipOffer(offers, { ...selection, getIdentity })).toBe(offers[0])
    expect(getIdentity).toHaveBeenCalledTimes(offers.length)
  })

  it('deduplicates by the caller-owned canonical product identity', () => {
    const first: Offer = {
      id: 'price-one',
      product: 'product-basic',
      interval: 'month',
      currency: 'cad',
      revision: 1,
    }
    const duplicate = { ...first, id: 'price-two', revision: 2 }
    const premium = { ...first, id: 'price-three', product: 'product-premium' }

    const deduplicated = dedupeMembershipOffersByProduct(
      [first, duplicate, premium],
      (offer) => offer.product,
    )

    expect(deduplicated).toHaveLength(2)
    expect(deduplicated[0]).toBe(first)
    expect(deduplicated[1]).toBe(premium)
  })

  it('groups and resolves each canonical product without product-specific policy', () => {
    const offers: Offer[] = [
      { id: 'basic-usd', product: 'basic', interval: 'month', currency: 'usd', revision: 3 },
      { id: 'basic-cad', product: 'basic', interval: 'month', currency: 'cad', revision: 2 },
      { id: 'premium-cad', product: 'premium', interval: 'month', currency: 'cad', revision: 1 },
    ]
    const grouped = groupMembershipOffersByProduct(offers, (offer) => offer.product)

    expect(grouped.get('basic')).toEqual([offers[0], offers[1]])
    expect(
      dedupeMembershipOffersByProduct(
        offers,
        (offer) => offer.product,
        (productOffers) => selectMembershipOffer(productOffers, selection),
      ),
    ).toEqual([offers[1], offers[2]])
  })

  it('omits a canonical product when its resolver returns undefined', () => {
    const offers: Offer[] = [
      { id: 'basic', product: 'basic', interval: 'month', currency: 'cad', revision: 1 },
      { id: 'premium', product: 'premium', interval: 'month', currency: 'cad', revision: 1 },
    ]

    expect(
      dedupeMembershipOffersByProduct(
        offers,
        (offer) => offer.product,
        (productOffers) => (productOffers[0]!.product === 'basic' ? undefined : productOffers[0]),
      ),
    ).toEqual([offers[1]])
  })
})
