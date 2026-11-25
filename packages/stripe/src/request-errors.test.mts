import Stripe from 'stripe'
import { describe, expect, it } from 'vitest'

import { createStripeClient } from './client.mts'
import {
  classifyStripeRequestError,
  getStripeRequestRejection,
  trackStripeRequestRejection,
  type StripeRequestEventSource,
} from './request-errors.mts'

function parameterMissingResponse(): Response {
  return new Response(
    JSON.stringify({
      error: {
        type: 'invalid_request_error',
        code: 'parameter_missing',
        message: 'Missing required param: charge.',
      },
    }),
    { status: 400, headers: { 'content-type': 'application/json' } },
  )
}

describe('classifyStripeRequestError', () => {
  it('classifies documented pre-execution authentication, rate-limit, and parameter failures', () => {
    expect(
      classifyStripeRequestError(new Stripe.errors.StripeAuthenticationError({ statusCode: 401 })),
    ).toBe('authentication')
    expect(
      classifyStripeRequestError(new Stripe.errors.StripeRateLimitError({ statusCode: 429 })),
    ).toBe('rate_limited')

    for (const code of [
      'parameter_invalid_empty',
      'parameter_invalid_integer',
      'parameter_invalid_string_blank',
      'parameter_invalid_string_empty',
      'parameter_missing',
      'parameter_unknown',
      'parameters_exclusive',
    ]) {
      expect(
        classifyStripeRequestError(
          new Stripe.errors.StripeInvalidRequestError({ statusCode: 400, code }),
        ),
      ).toBe('invalid_parameters')
    }
  })

  it('returns null for unknown, retried, or non-pre-execution errors', () => {
    for (const error of [
      null,
      'string error',
      new Error('network connection lost'),
      new Stripe.errors.StripeAPIError({ statusCode: 500 }),
      new Stripe.errors.StripeAuthenticationError({ statusCode: 403 }),
      new Stripe.errors.StripeRateLimitError({ statusCode: 429, code: 'lock_timeout' }),
      new Stripe.errors.StripeInvalidRequestError({
        statusCode: 400,
        code: 'charge_already_refunded',
      }),
      new Stripe.errors.StripeInvalidRequestError({ statusCode: 400 }),
      new Stripe.errors.StripeInvalidRequestError({
        statusCode: 409,
        code: 'idempotency_key_in_use',
      }),
    ]) {
      expect(classifyStripeRequestError(error)).toBeNull()
    }
  })
})

describe('trackStripeRequestRejection', () => {
  it('confirms a single-attempt pre-execution rejection through the Stripe SDK', async () => {
    const client = createStripeClient({
      apiKey: 'sk_test_fake',
      fetch: async () => parameterMissingResponse(),
      config: { maxNetworkRetries: 0 },
    })

    let caught: unknown
    try {
      await trackStripeRequestRejection(
        { stripe: client, method: 'POST', path: '/v1/refunds', idempotencyKey: 'key-single' },
        () => client.refunds.create({ charge: 'ch_1' }, { idempotencyKey: 'key-single' }),
      )
      expect.unreachable()
    } catch (error) {
      caught = error
    }

    expect(getStripeRequestRejection(caught)).toBe('invalid_parameters')
  })

  it('keeps an error unknown when a retry occurred before the rejection', async () => {
    let attempts = 0
    const client = createStripeClient({
      apiKey: 'sk_test_fake',
      fetch: async () => {
        attempts++
        if (attempts === 1)
          throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' })
        return parameterMissingResponse()
      },
      config: { maxNetworkRetries: 1 },
    })

    let caught: unknown
    try {
      await trackStripeRequestRejection(
        { stripe: client, method: 'POST', path: '/v1/refunds', idempotencyKey: 'key-retried' },
        () => client.refunds.create({ charge: 'ch_1' }, { idempotencyKey: 'key-retried' }),
      )
      expect.unreachable()
    } catch (error) {
      caught = error
    }

    expect(attempts).toBe(2)
    expect(getStripeRequestRejection(caught)).toBeNull()
  })

  it('keeps overlapping same-key calls unknown and isolates distinct keys', async () => {
    const makeConcurrentTest = async (sharedKey: boolean) => {
      const resolvers: Array<() => void> = []
      const client = createStripeClient({
        apiKey: 'sk_test_fake',
        fetch: () =>
          new Promise<Response>((resolve) => {
            resolvers.push(() => resolve(parameterMissingResponse()))
            if (resolvers.length === 2) {
              for (const release of resolvers) release()
            }
          }),
        config: { maxNetworkRetries: 0 },
      })

      const results = await Promise.allSettled(
        [0, 1].map((index) => {
          const idempotencyKey = sharedKey ? 'shared-key' : `separate-key-${index}`
          return trackStripeRequestRejection(
            { stripe: client, method: 'POST', path: '/v1/refunds', idempotencyKey },
            () => client.refunds.create({ charge: 'ch_1' }, { idempotencyKey }),
          )
        }),
      )
      return results.map((result) => {
        if (result.status !== 'rejected') throw new Error('Expected rejection')
        return getStripeRequestRejection(result.reason)
      })
    }

    expect(await makeConcurrentTest(true)).toEqual([null, null])
    expect(await makeConcurrentTest(false)).toEqual(['invalid_parameters', 'invalid_parameters'])
  })

  it('cleans up after success, ignores unrelated events, and handles unclassified or primitive throws', async () => {
    const listeners = new Set<(event: Stripe.RequestEvent) => void>()
    const fakeStripe: StripeRequestEventSource = {
      on: (_event, listener) => {
        listeners.add(listener)
      },
      off: (_event, listener) => {
        listeners.delete(listener)
      },
    }

    const emit = (event: Partial<Stripe.RequestEvent>) => {
      for (const listener of listeners) listener(event as Stripe.RequestEvent)
    }

    const ok = await trackStripeRequestRejection(
      { stripe: fakeStripe, method: 'POST', path: '/v1/refunds', idempotencyKey: 'reuse-key' },
      async () => {
        emit({ method: 'GET', path: '/v1/other', idempotency_key: 'reuse-key' })
        return 'ok'
      },
    )
    expect(ok).toBe('ok')
    expect(listeners.size).toBe(0)

    const apiError = new Stripe.errors.StripeAPIError({ statusCode: 500 })
    await expect(
      trackStripeRequestRejection(
        { stripe: fakeStripe, method: 'POST', path: '/v1/refunds', idempotencyKey: 'reuse-key' },
        async () => {
          emit({ method: 'POST', path: '/v1/refunds', idempotency_key: 'reuse-key' })
          throw apiError
        },
      ),
    ).rejects.toBe(apiError)
    expect(getStripeRequestRejection(apiError)).toBeNull()

    await expect(
      trackStripeRequestRejection(
        {
          stripe: fakeStripe,
          method: 'POST',
          path: '/v1/refunds',
          idempotencyKey: 'primitive-key',
        },
        async () => {
          emit({ method: 'POST', path: '/v1/refunds', idempotency_key: 'primitive-key' })
          // oxlint-disable-next-line no-throw-literal
          throw 'boom'
        },
      ),
    ).rejects.toBe('boom')
    expect(getStripeRequestRejection('boom')).toBeNull()
    expect(getStripeRequestRejection(null)).toBeNull()
  })
})
