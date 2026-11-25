import type Stripe from 'stripe'
import { describe, expect, it, vi } from 'vitest'

import {
  cancelStripeSubscription,
  getStripeKeyEnvironment,
  getStripeProviderEnvironment,
  type StripeSubscriptionCanceler,
} from './client.mts'
import { classifyStripeDisputeStatus, summarizeStripeDisputes } from './disputes.mts'
import {
  getStripeInvoiceSubscriptionId,
  getStripeObjectTimestamp,
  getStripeSubscriptionPeriod,
} from './event-utils.mts'
import { collectStripePages, parseStripeInvoicePaymentTarget } from './parsers.mts'
import { parseStripeEventBridgeEvent } from './webhook.mts'

const stripeKey = (prefix: 'sk' | 'pk' | 'rk', environment: 'test' | 'live') =>
  `${prefix}_${environment}_fixture`

describe('Stripe key environment helpers', () => {
  it('classifies test, live, and unrecognized Stripe keys', () => {
    expect(getStripeKeyEnvironment(stripeKey('sk', 'test'))).toBe('test')
    expect(getStripeKeyEnvironment(stripeKey('pk', 'test'))).toBe('test')
    expect(getStripeKeyEnvironment(stripeKey('rk', 'test'))).toBe('test')
    expect(getStripeKeyEnvironment(stripeKey('sk', 'live'))).toBe('production')
    expect(getStripeKeyEnvironment(stripeKey('pk', 'live'))).toBe('production')
    expect(getStripeKeyEnvironment(stripeKey('rk', 'live'))).toBe('production')
    expect(getStripeKeyEnvironment('')).toBeNull()
    expect(getStripeKeyEnvironment('whsec_test_1')).toBeNull()
  })

  it('derives provider environment and rejects mismatched keys', () => {
    expect(getStripeProviderEnvironment(stripeKey('sk', 'test'), stripeKey('pk', 'test'))).toBe(
      'test',
    )
    expect(getStripeProviderEnvironment(stripeKey('rk', 'test'), '')).toBe('test')
    expect(getStripeProviderEnvironment(stripeKey('sk', 'live'), stripeKey('pk', 'live'))).toBe(
      'production',
    )
    expect(getStripeProviderEnvironment('', '')).toBe('production')
    expect(getStripeProviderEnvironment()).toBe('production')
    expect(() =>
      getStripeProviderEnvironment(stripeKey('sk', 'test'), stripeKey('pk', 'live')),
    ).toThrow('Stripe keys use different environments')
  })
})

describe('cancelStripeSubscription', () => {
  const makeStripe = (
    cancel: ReturnType<typeof vi.fn>,
    retrieve: ReturnType<typeof vi.fn>,
  ): StripeSubscriptionCanceler => ({
    subscriptions: { cancel, retrieve } as unknown as StripeSubscriptionCanceler['subscriptions'],
  })

  it('forwards cancel arguments and skips retrieve on success', async () => {
    const canceled = { id: 'sub_1', status: 'canceled' }
    const cancel = vi.fn().mockResolvedValue(canceled)
    const retrieve = vi.fn()
    const stripe = makeStripe(cancel, retrieve)

    await expect(cancelStripeSubscription(stripe, 'sub_1')).resolves.toBe(canceled)
    expect(cancel).toHaveBeenCalledWith('sub_1')

    await cancelStripeSubscription(stripe, 'sub_1', { prorate: true })
    expect(cancel).toHaveBeenLastCalledWith('sub_1', { prorate: true })

    await cancelStripeSubscription(stripe, 'sub_1', undefined, { stripeAccount: 'acct_1' })
    expect(cancel).toHaveBeenLastCalledWith('sub_1', undefined, { stripeAccount: 'acct_1' })
    expect(retrieve).not.toHaveBeenCalled()
  })

  it('converges when cancel fails after the subscription is already canceled', async () => {
    const cancelError = new Error('DELETE reply lost')
    const canceled = { id: 'sub_canceled', status: 'canceled' }
    const cancel = vi.fn().mockRejectedValue(cancelError)
    const retrieve = vi.fn().mockResolvedValue(canceled)

    await expect(
      cancelStripeSubscription(makeStripe(cancel, retrieve), 'sub_canceled'),
    ).resolves.toBe(canceled)
    expect(retrieve).toHaveBeenCalledWith('sub_canceled')
  })

  it('forwards request options to retrieve so a connected-account cancel converges', async () => {
    const cancelError = new Error('DELETE reply lost')
    const canceled = { id: 'sub_connected', status: 'canceled' }
    const requestOptions = { stripeAccount: 'acct_connected' }
    const cancel = vi.fn().mockRejectedValue(cancelError)
    const retrieve = vi
      .fn()
      .mockImplementation(
        async (_id: string, _params?: unknown, opts?: { stripeAccount?: string }) => {
          if (opts?.stripeAccount !== 'acct_connected') {
            throw new Error('No such subscription on platform account')
          }
          return canceled
        },
      )

    await expect(
      cancelStripeSubscription(
        makeStripe(cancel, retrieve),
        'sub_connected',
        undefined,
        requestOptions,
      ),
    ).resolves.toBe(canceled)
    expect(cancel).toHaveBeenCalledWith('sub_connected', undefined, requestOptions)
    expect(retrieve).toHaveBeenCalledWith('sub_connected', undefined, requestOptions)
  })

  it('rethrows the original error when subscription is still active or retrieve fails', async () => {
    const activeError = new Error('DELETE forbidden')
    const activeStripe = makeStripe(
      vi.fn().mockRejectedValue(activeError),
      vi.fn().mockResolvedValue({ id: 'sub_active', status: 'active' }),
    )
    await expect(cancelStripeSubscription(activeStripe, 'sub_active')).rejects.toBe(activeError)

    const retrieveFailError = new Error('DELETE failed')
    const missingStripe = makeStripe(
      vi.fn().mockRejectedValue(retrieveFailError),
      vi.fn().mockRejectedValue(new Error('not found')),
    )
    await expect(cancelStripeSubscription(missingStripe, 'sub_missing')).rejects.toBe(
      retrieveFailError,
    )
  })
})

describe('parseStripeEventBridgeEvent', () => {
  it('unwraps a valid EventBridge envelope', () => {
    const event = {
      id: 'evt_1',
      object: 'event',
      type: 'invoice.paid',
      created: 1_700_000_000,
      data: { object: { id: 'in_1', object: 'invoice' } },
    }
    const body = JSON.stringify({
      version: '0',
      id: 'eb_1',
      source: 'aws.partner/stripe.com',
      detail: event,
    })

    expect(parseStripeEventBridgeEvent(body)).toEqual(event)
  })

  it('throws SyntaxError on invalid JSON', () => {
    expect(() => parseStripeEventBridgeEvent('not json')).toThrow(SyntaxError)
  })

  it('rejects non-object envelopes and missing or invalid detail values', () => {
    for (const raw of [
      'null',
      '42',
      '"text"',
      '[]',
      '{}',
      JSON.stringify({ id: 'evt_bare', type: 'invoice.paid' }),
      JSON.stringify({ detail: null }),
      JSON.stringify({ detail: [] }),
      JSON.stringify({ detail: 'bad' }),
    ]) {
      expect(() => parseStripeEventBridgeEvent(raw)).toThrow('EventBridge envelope missing detail')
    }

    for (const detail of [
      { foo: 'bar' },
      { id: '', type: 'invoice.paid' },
      { id: 'evt_1', type: '' },
      { id: 123, type: 'invoice.paid' },
    ]) {
      expect(() => parseStripeEventBridgeEvent(JSON.stringify({ detail }))).toThrow(
        'EventBridge envelope detail is not a Stripe event',
      )
    }
  })
})

describe('event-utils additions', () => {
  it('converts finite Unix timestamps to valid Dates', () => {
    expect(getStripeObjectTimestamp(1_700_000_000)).toEqual(new Date(1_700_000_000_000))
    expect(getStripeObjectTimestamp(0)).toEqual(new Date(0))
    expect(getStripeObjectTimestamp(-60)).toEqual(new Date(-60_000))
    expect(getStripeObjectTimestamp('1700000000')).toBeNull()
    expect(getStripeObjectTimestamp(null)).toBeNull()
    expect(getStripeObjectTimestamp(Number.NaN)).toBeNull()
    expect(getStripeObjectTimestamp(Number.POSITIVE_INFINITY)).toBeNull()
    expect(getStripeObjectTimestamp(1e20)).toBeNull()
  })

  it('reads invoice subscription ids from legacy and parent fields', () => {
    expect(getStripeInvoiceSubscriptionId({ subscription: 'sub_legacy' })).toBe('sub_legacy')
    expect(getStripeInvoiceSubscriptionId({ subscription: { id: 'sub_expanded' } })).toBe(
      'sub_expanded',
    )
    expect(
      getStripeInvoiceSubscriptionId({
        parent: { subscription_details: { subscription: 'sub_parent' } },
      }),
    ).toBe('sub_parent')
    expect(
      getStripeInvoiceSubscriptionId({
        parent: { subscription_details: { subscription: { id: 'sub_parent_obj' } } },
      }),
    ).toBe('sub_parent_obj')
    expect(getStripeInvoiceSubscriptionId({ parent: null })).toBeNull()
    expect(getStripeInvoiceSubscriptionId(null)).toBeNull()
    expect(getStripeInvoiceSubscriptionId([])).toBeNull()
    expect(getStripeInvoiceSubscriptionId('in_1')).toBeNull()
  })

  it('reads subscription period from top-level and first-item fields', () => {
    const legacy = {
      current_period_start: 100,
      current_period_end: 200,
      items: { data: [{ current_period_start: 300, current_period_end: 400 }] },
    } as unknown as Stripe.Subscription
    expect(getStripeSubscriptionPeriod(legacy)).toEqual({
      currentPeriodStart: new Date(100_000),
      currentPeriodEnd: new Date(200_000),
    })

    const basil = {
      items: { data: [{ current_period_start: 300, current_period_end: 400 }] },
    } as unknown as Stripe.Subscription
    expect(getStripeSubscriptionPeriod(basil)).toEqual({
      currentPeriodStart: new Date(300_000),
      currentPeriodEnd: new Date(400_000),
    })

    const empty = { items: { data: [] } } as unknown as Stripe.Subscription
    expect(getStripeSubscriptionPeriod(empty)).toEqual({
      currentPeriodStart: null,
      currentPeriodEnd: null,
    })
  })
})

describe('collectStripePages', () => {
  it('collects multiple pages and passes advancing cursors', async () => {
    const cursors: Array<string | undefined> = []
    const items = await collectStripePages({
      maxPages: 5,
      label: 'invoice',
      fetchPage: async (startingAfter) => {
        cursors.push(startingAfter)
        if (startingAfter === undefined) return { data: [{ id: 'in_1' }], has_more: true }
        return { data: [{ id: 'in_2' }, { id: 'in_3' }], has_more: false }
      },
    })

    expect(items).toEqual([{ id: 'in_1' }, { id: 'in_2' }, { id: 'in_3' }])
    expect(cursors).toEqual([undefined, 'in_1'])
  })

  it('rejects non-positive or non-integer maxPages', async () => {
    for (const maxPages of [0, -1, 1.5]) {
      await expect(
        collectStripePages({
          maxPages,
          fetchPage: async () => ({ data: [], has_more: false }),
        }),
      ).rejects.toThrow(RangeError)
    }
  })

  it('throws when the page limit is exceeded or a page cursor is invalid', async () => {
    let calls = 0
    await expect(
      collectStripePages({
        maxPages: 2,
        fetchPage: async () => {
          calls++
          return { data: [{ id: `item_${calls}` }], has_more: true }
        },
      }),
    ).rejects.toThrow('Stripe item listing exceeded the page limit (2)')
    expect(calls).toBe(2)

    await expect(
      collectStripePages({
        maxPages: 2,
        label: 'dispute',
        fetchPage: async () => ({ data: [], has_more: true }),
      }),
    ).rejects.toThrow('Stripe returned has_more without a dispute cursor')
  })
})

describe('parseStripeInvoicePaymentTarget', () => {
  it('extracts charge and payment intent ids from strings and expanded objects', () => {
    expect(parseStripeInvoicePaymentTarget({ type: 'charge', charge: 'ch_1' })).toEqual({
      type: 'charge',
      chargeId: 'ch_1',
      paymentIntentId: null,
    })
    expect(parseStripeInvoicePaymentTarget({ type: 'charge', charge: { id: 'ch_2' } })).toEqual({
      type: 'charge',
      chargeId: 'ch_2',
      paymentIntentId: null,
    })
    expect(
      parseStripeInvoicePaymentTarget({ type: 'payment_intent', payment_intent: 'pi_1' }),
    ).toEqual({
      type: 'payment_intent',
      chargeId: null,
      paymentIntentId: 'pi_1',
    })
    expect(
      parseStripeInvoicePaymentTarget({
        type: 'payment_intent',
        payment_intent: { id: 'pi_2' },
      }),
    ).toEqual({
      type: 'payment_intent',
      chargeId: null,
      paymentIntentId: 'pi_2',
    })
    expect(parseStripeInvoicePaymentTarget({ type: 'payment_record' })).toEqual({
      type: 'payment_record',
      chargeId: null,
      paymentIntentId: null,
    })
    expect(parseStripeInvoicePaymentTarget(null)).toEqual({
      type: '',
      chargeId: null,
      paymentIntentId: null,
    })
    expect(parseStripeInvoicePaymentTarget(undefined)).toEqual({
      type: '',
      chargeId: null,
      paymentIntentId: null,
    })
  })
})

describe('dispute classification and settlement', () => {
  it('classifies every documented Stripe dispute status and fails closed on unknown ones', () => {
    expect(classifyStripeDisputeStatus('lost')).toBe('lost')
    for (const status of [
      'needs_response',
      'under_review',
      'appeal_needs_response',
      'appeal_under_review',
      'warning_needs_response',
      'warning_under_review',
    ]) {
      expect(classifyStripeDisputeStatus(status)).toBe('open')
    }
    for (const status of ['prevented', 'warning_closed', 'won']) {
      expect(classifyStripeDisputeStatus(status)).toBe('closed')
    }
    expect(() => classifyStripeDisputeStatus('future_status')).toThrow(
      'Unsupported Stripe dispute status: future_status',
    )
  })

  it('summarizes lost dispute amounts and open disputes', () => {
    expect(summarizeStripeDisputes([], 'usd')).toEqual({
      lostDisputeAmountMinorUnits: 0,
      hasOpenDispute: false,
    })
    expect(
      summarizeStripeDisputes(
        [
          { status: 'won' },
          { status: 'prevented', amount: 500 },
          { status: 'warning_closed', amount: 300 },
        ],
        'usd',
      ),
    ).toEqual({ lostDisputeAmountMinorUnits: 0, hasOpenDispute: false })

    expect(
      summarizeStripeDisputes(
        [
          { status: 'lost', amount: 400, currency: 'usd' },
          { status: 'lost', amount: 250, currency: 'usd' },
          { status: 'under_review' },
        ],
        'usd',
      ),
    ).toEqual({ lostDisputeAmountMinorUnits: 650, hasOpenDispute: true })
  })

  it('rejects currency mismatches and missing amounts on lost disputes', () => {
    expect(() =>
      summarizeStripeDisputes([{ status: 'lost', amount: 400, currency: 'eur' }], 'usd'),
    ).toThrow('Stripe dispute currency eur did not match usd')

    expect(() => summarizeStripeDisputes([{ status: 'lost', currency: 'usd' }], 'usd')).toThrow(
      'Stripe lost dispute is missing a finite amount',
    )

    expect(() =>
      summarizeStripeDisputes([{ status: 'lost', amount: Number.NaN, currency: 'usd' }], 'usd'),
    ).toThrow('Stripe lost dispute is missing a finite amount')
  })
})
