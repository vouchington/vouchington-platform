import { describe, expect, it, vi } from 'vitest'
import { createSentryTunnel } from './sentry-tunnel.mts'

const DSN = 'https://abc@o1.ingest.sentry.io/123'
const PREVIOUS = 'https://def@o1.ingest.sentry.io/456'
const ENVELOPE = `${JSON.stringify({ dsn: DSN })}\n{"type":"event"}\n{}\n`

function setup(overrides: Partial<Parameters<typeof createSentryTunnel>[0]> = {}) {
  const log = { warn: vi.fn(), error: vi.fn() }
  const send = vi.fn(
    async (_url: string, _init: RequestInit) => new Response('upstream', { status: 200 }),
  )
  const handler = createSentryTunnel({
    trustedDsns: [DSN, undefined, 'bad', PREVIOUS],
    fetch: send,
    log,
    ...overrides,
  })
  return { handler, log, send }
}

const post = (body: string | null, headers: Record<string, string> = {}) =>
  new Request('https://example.com/tunnel', { method: 'POST', body, headers })

const logged = (mock: ReturnType<typeof vi.fn>) =>
  mock.mock.calls.map(([line]) => JSON.parse(line as string) as Record<string, unknown>)

describe('createSentryTunnel', () => {
  it('forwards binary envelope bytes unchanged', async () => {
    const { handler, send } = setup()
    const head = new TextEncoder().encode(
      `${JSON.stringify({ dsn: DSN })}\n{"type":"attachment","length":3}\n`,
    )
    const body = new Uint8Array([...head, 0xff, 0xfe, 0x80, 10])
    await handler(new Request('https://example.com/tunnel', { method: 'POST', body }))
    expect(send.mock.calls[0]![1].body).toEqual(body)
  })

  it('forwards envelopes for trusted DSNs and hides the upstream response', async () => {
    const { handler, send, log } = setup()
    const response = await handler(post(ENVELOPE))
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
    expect(send).toHaveBeenCalledWith('https://o1.ingest.sentry.io/api/123/envelope/', {
      method: 'POST',
      body: new TextEncoder().encode(ENVELOPE),
      headers: { 'content-type': 'application/x-sentry-envelope' },
    })
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('forwards to the previous DSN during rotation', async () => {
    const { handler, send } = setup()
    await handler(post(`${JSON.stringify({ dsn: PREVIOUS })}\n`))
    expect(send.mock.calls[0]?.[0]).toBe('https://o1.ingest.sentry.io/api/456/envelope/')
  })

  it('passes through upstream failures with no-store headers and diagnostics', async () => {
    const send = vi.fn(
      async () => new Response('x', { status: 429, headers: { 'retry-after': '9' } }),
    )
    const { handler, log } = setup({ fetch: send })
    const response = await handler(post(ENVELOPE, { 'cf-ray': 'ray-1' }))
    expect(response.status).toBe(429)
    expect(response.headers.has('retry-after')).toBe(false)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(logged(log.warn)[0]).toMatchObject({
      message: 'sentry_tunnel_upstream_response',
      status: 429,
      projectId: '123',
      cfRay: 'ray-1',
      envelopeItemCount: 1,
      envelopeItemTypes: ['event'],
    })
  })

  it('returns 502 and logs error details when the forward fails', async () => {
    const cause = Object.assign(new Error('inner'), { name: 'InnerError', code: 'ECONNRESET' })
    const failure = Object.assign(new Error('secret request data'), { cause })
    const { handler, log } = setup({ fetch: vi.fn().mockRejectedValue(failure) })
    const response = await handler(post(ENVELOPE))
    expect(response.status).toBe(502)
    const [entry] = logged(log.error)
    expect(entry).toMatchObject({
      message: 'sentry_tunnel_forward_failed',
      projectId: '123',
      errorName: 'Error',
      errorCauseName: 'InnerError',
      errorCode: 'ECONNRESET',
    })
    expect(JSON.stringify(entry)).not.toContain('secret request data')
  })

  it('summarizes non-error failures without leaking values', async () => {
    const { handler, log } = setup({ fetch: vi.fn().mockRejectedValue('string failure') })
    await handler(post(ENVELOPE))
    expect(logged(log.error)[0]).toMatchObject({ errorName: 'string' })
    const withCode = setup({ fetch: vi.fn().mockRejectedValue({ code: 42 }) })
    await withCode.handler(post(ENVELOPE))
    expect(logged(withCode.log.error)[0]).toMatchObject({ errorName: 'object', errorCode: '42' })
    const badCode = setup({ fetch: vi.fn().mockRejectedValue({ code: 'has spaces' }) })
    await badCode.handler(post(ENVELOPE))
    expect(logged(badCode.log.error)[0]).not.toHaveProperty('errorCode')
    const causeCode = setup({
      fetch: vi.fn().mockRejectedValue(new Error('x', { cause: { code: 'EPIPE' } })),
    })
    await causeCode.handler(post(ENVELOPE))
    expect(logged(causeCode.log.error)[0]).toMatchObject({ errorCode: 'EPIPE' })
    expect(logged(causeCode.log.error)[0]).not.toHaveProperty('errorCauseName')
    const nullCause = setup({ fetch: vi.fn().mockRejectedValue(new Error('x', { cause: null })) })
    await nullCause.handler(post(ENVELOPE))
    expect(logged(nullCause.log.error)[0]).not.toHaveProperty('errorCauseName')
    const ownCode = setup({
      fetch: vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error('x'), { code: 'OWN', cause: { code: 'CAUSE' } }),
        ),
    })
    await ownCode.handler(post(ENVELOPE))
    expect(logged(ownCode.log.error)[0]).toMatchObject({ errorCode: 'OWN' })
  })

  it('is unavailable without any valid trusted DSN', async () => {
    const { handler, log } = setup({ trustedDsns: [undefined, 'bad'] })
    const response = await handler(post(ENVELOPE))
    expect(response.status).toBe(503)
    expect(logged(log.warn)[0]).toMatchObject({
      message: 'sentry_tunnel_rejected',
      reason: 'configuration_unavailable',
      method: 'POST',
      requestPath: '/tunnel',
    })
  })

  it('rejects oversized declared and streamed bodies', async () => {
    const { handler, log, send } = setup({ maxBytes: 100 })
    const declared = await handler(post('x', { 'content-length': '101' }))
    expect(declared.status).toBe(413)
    expect(logged(log.warn)[0]).toMatchObject({
      reason: 'content_length_too_large',
      limitBytes: 100,
      contentLengthBytes: 101,
    })
    const streamed = await handler(post('x'.repeat(101)))
    expect(streamed.status).toBe(413)
    expect(logged(log.warn)[1]).toMatchObject({ reason: 'body_too_large' })
    expect(send).not.toHaveBeenCalled()
  })

  it('ignores a failing cancel while rejecting an oversized stream', async () => {
    const { handler } = setup({ maxBytes: 10 })
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('x'.repeat(11)))
      },
      cancel() {
        throw new Error('cancel failed')
      },
    })
    const request = new Request('https://example.com/tunnel', {
      method: 'POST',
      body,
      duplex: 'half',
    } as RequestInit)
    expect((await handler(request)).status).toBe(413)
  })

  it('rejects unreadable bodies', async () => {
    const { handler, log } = setup()
    const body = new ReadableStream({
      pull() {
        throw new Error('stream broke')
      },
    })
    const request = new Request('https://example.com/tunnel', {
      method: 'POST',
      body,
      duplex: 'half',
    } as RequestInit)
    expect((await handler(request)).status).toBe(400)
    expect(logged(log.warn)[0]).toMatchObject({ reason: 'body_read_error' })
  })

  it.each([
    ['an empty body', null, 'invalid_envelope_header'],
    ['a non-JSON header', 'not json\n', 'invalid_envelope_header'],
    ['a header without a DSN', '{}\n', 'missing_dsn'],
    ['a non-object header', '5\n', 'missing_dsn'],
    ['a null header', 'null\n', 'missing_dsn'],
    ['a non-string DSN', '{"dsn":5}\n', 'missing_dsn'],
    ['an unparseable DSN', '{"dsn":"nope"}\n', 'invalid_dsn'],
  ])('rejects %s with 400', async (_name, body, reason) => {
    const { handler, log } = setup()
    expect((await handler(post(body))).status).toBe(400)
    expect(logged(log.warn)[0]).toMatchObject({ reason })
  })

  it('rejects DSNs that are not trusted', async () => {
    const { handler, log, send } = setup()
    const response = await handler(post('{"dsn":"https://zzz@evil.test/9"}\n'))
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ message: 'Forbidden', code: 'FORBIDDEN' })
    expect(logged(log.warn)[0]).toMatchObject({ reason: 'dsn_not_allowed' })
    expect(send).not.toHaveBeenCalled()
  })

  it('defaults to console logging, global fetch, and a 1 MB cap', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))
    const handler = createSentryTunnel({ trustedDsns: [DSN] })
    expect((await handler(post(ENVELOPE))).status).toBe(200)
    expect(spy).toHaveBeenCalledTimes(1)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect((await handler(post('x', { 'content-length': '1000001' }))).status).toBe(413)
    expect(warn).toHaveBeenCalledTimes(1)
    spy.mockRestore()
    warn.mockRestore()
  })

  it('omits unavailable request diagnostics', async () => {
    const { handler, log } = setup({ trustedDsns: [] })
    await handler(post(null, { 'content-length': 'abc' }))
    const [entry] = logged(log.warn)
    expect(entry).not.toHaveProperty('cfRay')
    expect(entry).not.toHaveProperty('contentLengthBytes')
  })

  it('prefers the runtime cf ray and handles an empty body cap', async () => {
    const { handler, log } = setup({ trustedDsns: [] })
    const request = post(null)
    Object.defineProperty(request, 'cf', { value: { ray: 'runtime-ray' } })
    await handler(request)
    expect(logged(log.warn)[0]).toMatchObject({ cfRay: 'runtime-ray' })
  })
})
