import { describe, expect, it } from 'vitest'
import {
  SES_CLIENT_CONFIG,
  buildEmailCommand,
  buildRawEmailMessage,
  buildSendEmailCommand,
  buildSendRawEmailCommand,
} from './ses.mts'

const base = { source: 'from@example.com', to: 'to@example.com', subject: 'Hello' }
const b64 = (value: string) => Buffer.from(value).toString('base64')

describe('buildRawEmailMessage', () => {
  it('builds multipart with caller headers and an injected boundary', () => {
    const raw = buildRawEmailMessage({
      ...base,
      to: ['a@example.com', 'b@example.com'],
      replyTo: ['r@example.com'],
      text: 'Text body',
      html: '<p>HTML</p>',
      headers: { 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      boundary: 'fixed',
    })
    expect(raw).toContain('From: from@example.com\r\n')
    expect(raw).toContain('To: a@example.com,\r\n b@example.com\r\n')
    expect(raw).toContain('Reply-To: r@example.com\r\n')
    expect(raw).toContain('\r\nList-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n')
    expect(raw).toContain('multipart/alternative; boundary="fixed"')
    expect(raw).toContain(b64('Text body'))
    expect(raw).toContain(b64('<p>HTML</p>'))
    expect(raw.endsWith('--fixed--\r\n')).toBe(true)
  })

  it('generates a prefixed boundary by default', () => {
    const raw = buildRawEmailMessage({ ...base, text: 't', html: 'h', boundaryPrefix: 'app' })
    expect(raw).toMatch(/boundary="app-[0-9a-f-]{36}"/)
    expect(buildRawEmailMessage({ ...base, text: 't', html: 'h' })).toMatch(/boundary="mime-/)
  })

  it.each([
    [{ html: '<p>x</p>' }, 'text/html', '<p>x</p>'],
    [{ text: 'plain' }, 'text/plain', 'plain'],
    [{}, 'text/plain', ''],
  ] as const)('builds single-part email', (body, type, content) => {
    const raw = buildRawEmailMessage({ ...base, ...body })
    expect(raw).toContain(`Content-Type: ${type}; charset=UTF-8`)
    expect(raw).not.toContain('Reply-To')
    if (content) expect(raw).toContain(b64(content))
  })

  it('encodes non-ASCII subjects, normalizes line endings, and wraps lines', () => {
    const raw = buildRawEmailMessage({
      ...base,
      subject: 'Café',
      text: 'a\nb\rc',
      html: `<p>${'x'.repeat(500)}</p>`,
    })
    expect(raw).toContain(`Subject: =?UTF-8?B?${b64('Café')}?=`)
    expect(raw).toContain(b64('a\r\nb\r\nc'))
    expect(raw).not.toMatch(/(?<!\r)\n|\r(?!\n)/)
    expect(Math.max(...raw.split('\r\n').map((line) => line.length))).toBeLessThanOrEqual(998)
  })

  it.each([
    [{ subject: 'a\r\nBcc: x' }],
    [{ source: 'a\nb' }],
    [{ to: 'a\nb' }],
    [{ replyTo: 'a\nb' }],
    [{ headers: { 'X-A': 'b\nc' } }],
    [{ headers: { 'X-A\n': 'b' } }],
  ])('rejects header injection', (override) => {
    expect(() => buildRawEmailMessage({ ...base, ...override })).toThrow(TypeError)
  })
})

describe('ses commands', () => {
  it('exposes single-attempt dual-stack client config', () => {
    expect(SES_CLIENT_CONFIG).toEqual({ useDualstackEndpoint: true, maxAttempts: 1 })
  })

  it('rejects invalid MIME boundaries', () => {
    for (const boundary of ['x"\r\nX-Injected: y', 'a b', '']) {
      expect(() => buildRawEmailMessage({ ...base, text: 't', html: 'h', boundary })).toThrow(
        'Invalid MIME boundary',
      )
    }
    expect(() =>
      buildRawEmailMessage({ ...base, text: 't', html: 'h', boundaryPrefix: 'a"b' }),
    ).toThrow(TypeError)
  })

  it('requires a body for structured SendEmail', () => {
    expect(() => buildSendEmailCommand(base)).toThrow(TypeError)
    expect(buildSendEmailCommand({ ...base, html: '<p>h</p>' }).input.Message?.Body).toEqual({
      Html: { Charset: 'UTF-8', Data: '<p>h</p>' },
    })
  })

  it('builds a structured SendEmail command', () => {
    const command = buildSendEmailCommand({
      ...base,
      to: ['a@example.com'],
      bcc: ['bcc@example.com'],
      replyTo: 'reply@example.com',
      text: 't',
      html: 'h',
      configurationSetName: 'set',
    })
    expect(command.input).toMatchObject({
      Destination: { BccAddresses: ['bcc@example.com'], ToAddresses: ['a@example.com'] },
      Source: 'from@example.com',
      ReplyToAddresses: ['reply@example.com'],
      ConfigurationSetName: 'set',
      Message: {
        Subject: { Data: 'Hello' },
        Body: { Text: { Data: 't' }, Html: { Data: 'h' } },
      },
    })
  })

  it('omits optional SendEmail fields', () => {
    const command = buildSendEmailCommand({ ...base, text: 't' })
    expect(command.input.ReplyToAddresses).toBeUndefined()
    expect(command.input.ConfigurationSetName).toBeUndefined()
    expect(command.input.Destination?.BccAddresses).toEqual([])
    expect(command.input.Message?.Body).toEqual({ Text: { Charset: 'UTF-8', Data: 't' } })
  })

  it('builds a SendRawEmail command with BCC destinations', () => {
    const command = buildSendRawEmailCommand({
      ...base,
      bcc: ['bcc@example.com'],
      text: 't',
      configurationSetName: 'set',
    })
    expect(command.input.Destinations).toEqual(['to@example.com', 'bcc@example.com'])
    expect(command.input.ConfigurationSetName).toBe('set')
    expect(command.input.RawMessage?.Data).toBeInstanceOf(Buffer)
    expect(buildSendRawEmailCommand(base).input.Destinations).toEqual(['to@example.com'])
    expect(buildSendRawEmailCommand(base).input.ConfigurationSetName).toBeUndefined()
  })

  it('selects raw only when custom headers exist', () => {
    expect(buildEmailCommand({ ...base, text: 't' }).constructor.name).toBe('SendEmailCommand')
    expect(buildEmailCommand({ ...base, text: 't', headers: {} }).constructor.name).toBe(
      'SendEmailCommand',
    )
    expect(buildEmailCommand({ ...base, headers: { 'X-A': 'b' } }).constructor.name).toBe(
      'SendRawEmailCommand',
    )
  })
})
