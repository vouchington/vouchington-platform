import type Stripe from 'stripe'
import { describe, expect, it } from 'vitest'

import {
  buildCatalogPriceLookupParams,
  buildRecurringCatalogPriceParams,
  pickCatalogPrice,
  validateRecurringCatalogPrice,
  type RecurringCatalogDescriptor,
} from './catalog.mts'
import {
  buildBillingPortalParams,
  buildCustomerCreateParams,
  buildCustomerRedactionParams,
  buildCustomerSearchParams,
  buildIdentityVerificationParams,
  buildOneTimeCheckoutParams,
  buildPauseCollectionParams,
  buildRefundListParams,
  buildRefundParams,
  buildSubscriptionCheckoutParams,
} from './params.mts'
import {
  isStripeResourceExistsError,
  parseStripePage,
  parseVerificationSession,
} from './parsers.mts'

const urls = { successUrl: 's', cancelUrl: 'c' }
const metadata = { a: 'b' }

describe('param builders', () => {
  it('builds checkout params', () => {
    const sub = buildSubscriptionCheckoutParams({
      customerId: 'cus',
      priceId: 'p',
      metadata,
      ...urls,
    })
    expect(sub).toMatchObject({ mode: 'subscription', subscription_data: { metadata } })
    expect(sub.line_items).toEqual([{ price: 'p', quantity: 1 }])
    const once = buildOneTimeCheckoutParams({
      customerId: 'cus',
      priceAmountMinorUnits: 500,
      currency: 'usd',
      productName: 'N',
      metadata,
      ...urls,
    })
    expect(once.mode).toBe('payment')
    expect(once.line_items?.[0]?.price_data?.unit_amount).toBe(500)
  })

  it('builds portal params with optional cancel flow', () => {
    expect(buildBillingPortalParams({ customerId: 'c', returnUrl: 'r' })).toEqual({
      customer: 'c',
      return_url: 'r',
    })
    expect(
      buildBillingPortalParams({ customerId: 'c', returnUrl: 'r', cancellationSubscriptionId: 's' })
        .flow_data,
    ).toMatchObject({ type: 'subscription_cancel', subscription_cancel: { subscription: 's' } })
  })

  it('builds customer params and escapes search values', () => {
    expect(buildCustomerSearchParams('userId', 'a"b\\c').query).toBe(
      'metadata["userId"]:"a\\"b\\\\c"',
    )
    expect(() => buildCustomerSearchParams('bad"key', 'x')).toThrow('Invalid Stripe metadata key')
    expect(buildCustomerCreateParams(metadata)).toEqual({ metadata })
    expect(buildCustomerCreateParams(metadata, 'e@x.test')).toEqual({ email: 'e@x.test', metadata })
    expect(buildCustomerRedactionParams()).toEqual({
      email: '',
      name: '',
      metadata: { redacted: 'true' },
    })
    expect(buildCustomerRedactionParams(metadata).metadata).toBe(metadata)
  })

  it('builds refund params', () => {
    expect(buildRefundParams({})).toEqual({})
    expect(
      buildRefundParams({ chargeId: 'ch', paymentIntentId: 'pi', amountMinorUnits: 0, metadata }),
    ).toEqual({ charge: 'ch', payment_intent: 'pi', amount: 0, metadata })
  })

  it('builds refund list params for exactly one target', () => {
    expect(buildRefundListParams({ chargeId: 'ch', paymentIntentId: null })).toEqual({
      charge: 'ch',
      limit: 100,
    })
    expect(
      buildRefundListParams({
        chargeId: null,
        paymentIntentId: 'pi',
        startingAfter: 'x',
        limit: 5,
      }),
    ).toEqual({ payment_intent: 'pi', limit: 5, starting_after: 'x' })
    expect(() => buildRefundListParams({ chargeId: null, paymentIntentId: null })).toThrow(
      'requires a charge or payment intent',
    )
    expect(() => buildRefundListParams({ chargeId: 'a', paymentIntentId: 'b' })).toThrow(
      'cannot use both',
    )
  })

  it('builds pause and identity params', () => {
    expect(buildPauseCollectionParams('void')).toEqual({ pause_collection: { behavior: 'void' } })
    expect(buildPauseCollectionParams('clear')).toEqual({ pause_collection: '' })
    expect(buildIdentityVerificationParams({ returnUrl: 'r', metadata })).toMatchObject({
      type: 'document',
      return_url: 'r',
    })
  })
})

describe('parsers', () => {
  const list = (ids: string[], has_more: boolean) => ({ data: ids.map((id) => ({ id })), has_more })

  it('validates page cursors', () => {
    expect(parseStripePage(list(['a'], false))).toEqual({
      items: [{ id: 'a' }],
      hasMore: false,
      nextCursor: undefined,
    })
    expect(parseStripePage(list(['a', 'b'], true), 'z').nextCursor).toBe('b')
    expect(() => parseStripePage(list([], true), undefined, 'refund')).toThrow(
      'without a refund cursor',
    )
    expect(() => parseStripePage(list(['a'], true), 'a')).toThrow('without advancing the item')
  })

  it('interprets verification sessions', () => {
    expect(parseVerificationSession({ status: 'canceled' })).toEqual({ outcome: 'canceled' })
    expect(parseVerificationSession({ status: 'requires_input' })).toEqual({
      outcome: 'requires_input',
    })
    expect(parseVerificationSession({ status: 'processing' })).toEqual({ outcome: 'failed' })
    expect(parseVerificationSession({ status: 'verified' })).toEqual({ outcome: 'requires_input' })
    expect(
      parseVerificationSession({
        status: 'verified',
        verified_outputs: { first_name: 'A', last_name: 'B' },
        last_verification_report: {
          document: { type: 'passport', issuing_country: 'US', number: { value: '9' } },
        },
      }),
    ).toEqual({
      outcome: 'verified',
      firstName: 'A',
      lastName: 'B',
      fullName: 'A B',
      documentNumber: '9',
      issuingCountry: 'US',
      documentType: 'passport',
    })
    expect(
      parseVerificationSession({
        status: 'verified',
        verified_outputs: { id_number: '1', id_number_type: 'ssn', address: { country: 'CA' } },
        last_verification_report: { document: { first_name: { value: 'Solo' } } },
      }),
    ).toMatchObject({
      fullName: 'Solo',
      documentNumber: '1',
      issuingCountry: 'CA',
      documentType: 'ssn',
    })
    expect(
      parseVerificationSession({
        status: 'verified',
        last_verification_report: {
          document: {
            last_name: { value: 'L' },
            type: 't',
            issuing_country: 'US',
            number: { value: '1' },
          },
        },
      }),
    ).toMatchObject({ firstName: null, fullName: 'L' })
    expect(
      parseVerificationSession({
        status: 'verified',
        verified_outputs: { id_number: '1', id_number_type: 't', address: { country: 'US' } },
      }),
    ).toMatchObject({ fullName: null })
  })

  it('detects resource-exists errors', () => {
    const err = {
      type: 'StripeInvalidRequestError',
      code: 'resource_already_exists',
      param: 'lookup_key',
    }
    expect(isStripeResourceExistsError(err, 'lookup_key')).toBe(true)
    expect(isStripeResourceExistsError(err, 'other')).toBe(false)
    expect(isStripeResourceExistsError(null, 'lookup_key')).toBe(false)
  })
})

describe('catalog', () => {
  const descriptor: RecurringCatalogDescriptor = {
    lookupKey: 'gold_month',
    productName: 'Gold',
    unitAmount: 500,
    interval: 'month',
    currency: 'usd',
    productMetadata: { version: 'v1' },
  }
  const price = (over: Record<string, unknown> = {}) =>
    ({
      active: true,
      lookup_key: 'gold_month',
      currency: 'usd',
      unit_amount: 500,
      recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
      billing_scheme: 'per_unit',
      transform_quantity: null,
      ...over,
    }) as unknown as Stripe.Price
  const product = (over: Record<string, unknown> = {}) =>
    ({
      active: true,
      name: 'Gold',
      metadata: { version: 'v1' },
      ...over,
    }) as unknown as Stripe.Product

  it('builds create and lookup params', () => {
    expect(buildRecurringCatalogPriceParams(descriptor)).toMatchObject({
      currency: 'usd',
      lookup_key: 'gold_month',
      product_data: { name: 'Gold', metadata: { version: 'v1' } },
    })
    expect(buildCatalogPriceLookupParams('k').limit).toBe(2)
  })

  it('picks a single price', () => {
    expect(pickCatalogPrice([], 'k')).toBeNull()
    expect(pickCatalogPrice([price()], 'k')).toBeDefined()
    expect(() => pickCatalogPrice([price(), price()], 'k')).toThrow('multiple prices')
  })

  it('validates descriptors', () => {
    const p = price()
    expect(validateRecurringCatalogPrice(p, product(), descriptor)).toBe(p)
    for (const [pr, pd] of [
      [price({ active: false }), product()],
      [price(), product({ active: false })],
      [price(), product({ deleted: true })],
      [price(), null],
    ] as const)
      expect(() => validateRecurringCatalogPrice(pr, pd as never, descriptor)).toThrow('inactive')
    for (const [pr, pd] of [
      [price({ unit_amount: 1 }), product()],
      [price(), product({ name: 'X' })],
      [price(), product({ metadata: {} })],
      [price({ recurring: null }), product()],
    ] as const)
      expect(() => validateRecurringCatalogPrice(pr, pd, descriptor)).toThrow('does not match')
  })
})
