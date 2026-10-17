import Stripe from 'stripe'
import { describe, expect, it } from 'vitest'

import { createStripeClient, idempotencyOptions } from './client.mts'
import {
  getStripeObjectBoolean,
  getStripeObjectId,
  getStripeObjectNumber,
  getStripeObjectString,
  mapStripeSubscriptionStatus,
  normalizeStripeEvent,
} from './event-utils.mts'
import {
  StripeWebhookSignatureError,
  assertStripeEventType,
  isStripeEventType,
  verifyStripeWebhook,
} from './webhook.mts'

const stripe = new Stripe('sk_test_fake')
const secret = 'whsec_test'
const event = {
  id: 'evt_1',
  object: 'event',
  type: 'customer.subscription.updated',
  created: 1_700_000_000,
  data: { object: { id: 'sub_1', object: 'subscription', customer: 'cus_1' } },
}
const payload = JSON.stringify(event)
const sign = (body: string, timestamp?: number) =>
  stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret,
    ...(timestamp ? { timestamp } : {}),
  })

describe('verifyStripeWebhook', () => {
  it('returns the verified event', () => {
    const result = verifyStripeWebhook({ stripe, payload, signature: sign(payload), secret })
    expect(result.id).toBe('evt_1')
  })

  it('rejects missing signatures', () => {
    expect(() => verifyStripeWebhook({ stripe, payload, signature: null, secret })).toThrow(
      StripeWebhookSignatureError,
    )
  })

  it('rejects tampered payloads and keeps the cause', () => {
    const signature = sign(payload)
    try {
      verifyStripeWebhook({ stripe, payload: payload + ' ', signature, secret })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(StripeWebhookSignatureError)
      expect((error as Error).cause).toBeDefined()
    }
  })

  it('honors the tolerance', () => {
    const old = Math.floor(Date.now() / 1000) - 1000
    const signature = sign(payload, old)
    expect(() => verifyStripeWebhook({ stripe, payload, signature, secret })).toThrow()
    expect(
      verifyStripeWebhook({ stripe, payload, signature, secret, toleranceSeconds: 5000 }).id,
    ).toBe('evt_1')
  })
})

describe('event narrowing', () => {
  const parsed = event as unknown as Stripe.Event

  it('narrows by type', () => {
    expect(isStripeEventType(parsed, 'customer.subscription.updated')).toBe(true)
    expect(isStripeEventType(parsed, 'charge.refunded', 'invoice.paid')).toBe(false)
    expect(assertStripeEventType(parsed, 'customer.subscription.updated').id).toBe('evt_1')
    expect(() => assertStripeEventType(parsed, 'charge.refunded', 'invoice.paid')).toThrow(
      'Expected Stripe event charge.refunded | invoice.paid, received customer.subscription.updated',
    )
  })
})

describe('event utils', () => {
  it('reads primitive and expanded ids', () => {
    expect(getStripeObjectString('')).toBeNull()
    expect(getStripeObjectString('a')).toBe('a')
    expect(getStripeObjectId('a')).toBe('a')
    expect(getStripeObjectId({ id: 'b' })).toBe('b')
    expect(getStripeObjectId(null)).toBeNull()
    expect(getStripeObjectId([])).toBeNull()
    expect(getStripeObjectNumber(1)).toBe(1)
    expect(getStripeObjectNumber('1')).toBeNull()
    expect(getStripeObjectBoolean(false)).toBe(false)
    expect(getStripeObjectBoolean(0)).toBeNull()
  })

  it('normalizes correlation ids per object type', () => {
    const make = (object: Record<string, unknown>) =>
      normalizeStripeEvent({ created: 10, data: { object } } as unknown as Stripe.Event)
    expect(make({ id: 'sub_1', object: 'subscription', customer: 'cus_1' })).toEqual({
      stripeCreatedAt: new Date(10_000),
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      invoiceId: null,
      checkoutSessionId: null,
    })
    expect(make({ id: 'cus_1', object: 'customer' }).customerId).toBe('cus_1')
    expect(make({ id: 'in_1', object: 'invoice', subscription: 'sub_2' })).toMatchObject({
      invoiceId: 'in_1',
      subscriptionId: 'sub_2',
    })
    expect(make({ id: 'cs_1', object: 'checkout.session', invoice: { id: 'in_2' } })).toMatchObject(
      { checkoutSessionId: 'cs_1', invoiceId: 'in_2' },
    )
  })

  it('maps subscription statuses', () => {
    const cases: [string, string][] = [
      ['active', 'active'],
      ['trialing', 'active'],
      ['past_due', 'past_due'],
      ['paused', 'paused'],
      ['canceled', 'cancelled'],
      ['unpaid', 'cancelled'],
      ['incomplete', 'expired'],
      ['incomplete_expired', 'expired'],
    ]
    for (const [input, output] of cases) expect(mapStripeSubscriptionStatus(input)).toBe(output)
    expect(() => mapStripeSubscriptionStatus('wat')).toThrow('Unknown Stripe subscription status')
  })
})

describe('client', () => {
  it('builds a client with an injected fetch', async () => {
    const calls: string[] = []
    const fakeFetch = (async (url: string | URL | Request) => {
      calls.push(typeof url === 'string' ? url : url instanceof URL ? url.href : url.url)
      return new Response(JSON.stringify({ id: 'cus_1', object: 'customer' }), {
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch
    const client = createStripeClient({ apiKey: 'sk_test_fake', fetch: fakeFetch, timeoutMs: 50 })
    await client.customers.retrieve('cus_1')
    expect(calls[0]).toContain('/v1/customers/cus_1')
    expect(
      createStripeClient({ apiKey: 'sk_test_fake', config: { maxNetworkRetries: 0 } }),
    ).toBeDefined()
  })

  it('requires an api key', () => {
    expect(() => createStripeClient({ apiKey: '' })).toThrow('apiKey is required')
  })

  it('builds idempotency options', () => {
    expect(idempotencyOptions()).toBeUndefined()
    expect(idempotencyOptions('k')).toEqual({ idempotencyKey: 'k' })
  })
})
