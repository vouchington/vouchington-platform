import type { Breadcrumb, ErrorEvent, EventHint } from '@sentry/core'
import { describe, expect, it } from 'vitest'
import { createSentryInitOptions } from './index.mts'

const base = {
  dsn: 'https://key@sentry.test/1',
  environment: 'production',
  enabledEnvironments: ['production'],
  scrub: { credentialHeaders: ['authorization'] },
  spikeProtection: false as const,
}
const hint = {} as EventHint

function leakyEvent(): ErrorEvent {
  return {
    type: undefined,
    message: 'failed for person@example.test',
    user: { id: '1', email: 'person@example.test' },
    extra: { nested: { token: 'abc123', note: 'ok' } },
    contexts: { app: { api_key: 'k' } },
    tags: { password: 'p' },
    exception: { values: [{ value: 'bad Bearer abc.def-1' }] },
    breadcrumbs: [
      { message: 'mail person@example.test with Bearer abc.def-1', data: { secret: 's' } },
    ],
  } as unknown as ErrorEvent
}

describe('recursive event scrubbing', () => {
  it('redacts user, extra, contexts, tags, messages, and breadcrumb text', async () => {
    const { beforeSend } = createSentryInitOptions(base)
    const sent = (await beforeSend(leakyEvent(), hint)) as unknown as Record<string, any>
    expect(sent.user).toEqual({ id: '1', email: '[Filtered]' })
    expect(sent.extra.nested).toEqual({ token: '[Filtered]', note: 'ok' })
    expect(sent.contexts.app.api_key).toBe('[Filtered]')
    expect(sent.tags.password).toBe('[Filtered]')
    expect(sent.message).toBe('failed for [Filtered email]')
    expect(sent.exception.values[0].value).toBe('bad Bearer [Filtered token]')
    expect(sent.breadcrumbs[0]).toEqual({
      message: 'mail [Filtered email] with Bearer [Filtered token]',
      data: { secret: '[Filtered]' },
    })
  })

  it('scrubs data reintroduced by an injected beforeSend', async () => {
    const { beforeSend } = createSentryInitOptions({
      ...base,
      beforeSend: (event) => ({ ...event, user: { email: 'late@example.test' } }),
    })
    const sent = (await beforeSend({ message: 'm' } as ErrorEvent, hint)) as ErrorEvent
    expect(sent.user).toEqual({ email: '[Filtered]' })
  })

  it('scrubs a breadcrumb after the injected beforeBreadcrumb runs', () => {
    const { beforeBreadcrumb } = createSentryInitOptions({
      ...base,
      beforeBreadcrumb: (crumb) => ({ ...crumb, message: 'late@example.test' }),
    })
    expect(beforeBreadcrumb({ message: 'x', data: { token: 't' } } as Breadcrumb)).toEqual({
      message: '[Filtered email]',
      data: { token: '[Filtered]' },
    })
  })

  it('scrubs breadcrumbs without a hook and honors a hook that drops them', () => {
    const plain = createSentryInitOptions(base).beforeBreadcrumb
    expect(plain({ message: 'Bearer abc' } as Breadcrumb)).toEqual({
      message: 'Bearer [Filtered token]',
    })
    const dropping = createSentryInitOptions({ ...base, beforeBreadcrumb: () => null })
    expect(dropping.beforeBreadcrumb({ message: 'x' } as Breadcrumb)).toBeNull()
  })
})
