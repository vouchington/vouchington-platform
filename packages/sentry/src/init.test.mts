import type { ErrorEvent, EventHint } from '@sentry/core'
import { describe, expect, it, vi } from 'vitest'
import { createSentryInitOptions, createSpanScrubber } from './index.mts'

const scrub = { credentialHeaders: ['authorization'] }
const base = {
  dsn: 'https://key@sentry.test/1',
  environment: 'production',
  enabledEnvironments: ['staging', 'production'],
  scrub,
}
const hint = (originalException?: unknown) => ({ originalException }) as EventHint

describe('createSentryInitOptions', () => {
  it('enables reporting for an allowed environment with a DSN', () => {
    const options = createSentryInitOptions({ ...base, release: 'abc', tracesSampleRate: 0.5 })
    expect(options).toMatchObject({
      dsn: base.dsn,
      environment: 'production',
      release: 'abc',
      enabled: true,
      tracesSampleRate: 0.5,
    })
    expect(options.dataCollection).toMatchObject({ userInfo: false })
    expect('tunnel' in options).toBe(false)
    expect('tracesSampleRate' in createSentryInitOptions(base)).toBe(false)
    expect('initialScope' in options).toBe(false)
  })

  it('fails closed for unlisted environments without warning', () => {
    const onMisconfigured = vi.fn()
    const options = createSentryInitOptions({ ...base, environment: 'test', onMisconfigured })
    expect(options.enabled).toBe(false)
    expect(onMisconfigured).not.toHaveBeenCalled()
  })

  it('disables and reports a missing DSN in an allowed environment', () => {
    const onMisconfigured = vi.fn()
    const options = createSentryInitOptions({ ...base, dsn: '  ', release: '', onMisconfigured })
    expect(options).toMatchObject({ enabled: false, dsn: undefined, release: undefined })
    expect(onMisconfigured).toHaveBeenCalledOnce()
    expect(createSentryInitOptions({ ...base, dsn: undefined }).enabled).toBe(false)
  })

  it('falls back to a default environment and passes tunnel and scope through', () => {
    const initialScope = { tags: { lambda: 'x' } }
    const options = createSentryInitOptions({
      ...base,
      environment: undefined,
      tunnel: '/tunnel',
      initialScope,
    })
    expect(options).toMatchObject({ environment: 'development', tunnel: '/tunnel', initialScope })
    expect(
      createSentryInitOptions({ ...base, environment: undefined, fallbackEnvironment: 'ci' }),
    ).toMatchObject({ environment: 'ci' })
  })

  it('filters, runs the custom hook, scrubs, and spike-limits events', async () => {
    const custom = vi.fn((event: ErrorEvent) => event)
    const options = createSentryInitOptions({
      ...base,
      beforeSend: custom,
      spikeProtection: { limit: 1 },
      filter: { isExpected: (error) => error === 'expected' },
    })
    const event = {
      message: 'boom',
      request: { headers: { authorization: 'secret' } },
    } as unknown as ErrorEvent
    const sent = (await options.beforeSend(event, hint(new Error('boom')))) as ErrorEvent
    expect(sent.request?.headers).toEqual({ authorization: '[Filtered]' })
    expect(await options.beforeSend(event, hint(new Error('boom')))).toBeNull()
    expect(await options.beforeSend(event, hint('expected'))).toBeNull()
    expect(custom).toHaveBeenCalledTimes(2)
  })

  it('skips spike protection when disabled', async () => {
    const options = createSentryInitOptions({ ...base, spikeProtection: false })
    const event = { message: 'same' } as unknown as ErrorEvent
    for (let i = 0; i < 20; i += 1) {
      expect(await options.beforeSend(event, hint())).not.toBeNull()
    }
  })

  it('scrubs span attributes', () => {
    const options = createSentryInitOptions(base)
    const span = { attributes: { 'url.full': 'https://a.test/x?token=1' } }
    const scrubbed = (options.beforeSendSpan as unknown as (value: typeof span) => typeof span)(
      span,
    )
    expect(scrubbed.attributes['url.full']).toBe('https://a.test/x')
  })
})

describe('createSpanScrubber', () => {
  it('returns unchanged spans as-is', () => {
    const span = { attributes: { plain: 'value' } }
    expect(createSpanScrubber(scrub)(span)).toBe(span)
  })
})
