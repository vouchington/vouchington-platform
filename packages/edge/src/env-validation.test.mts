import { describe, expect, it, vi } from 'vitest'
import {
  createEnvWarner,
  isProductionMode,
  isProductionValueInvalid,
  isSecretValid,
  warnIfAssetOriginInvalid,
  warnIfDsnInvalid,
  warnIfProductionValueInvalid,
  warnIfSecretMisconfigured,
} from './env-validation.mts'
import { parseSentryDsn } from './sentry-dsn.mts'

function setup() {
  const log = { error: vi.fn(), warn: vi.fn() }
  return { log, warn: createEnvWarner(log) }
}

describe('createEnvWarner', () => {
  it('logs each key once at the requested level', () => {
    const { log, warn } = setup()
    warn('k', 'first')
    warn('k', 'second')
    warn('w', 'careful', 'warn')
    expect(log.error.mock.calls).toEqual([['first']])
    expect(log.warn.mock.calls).toEqual([['careful']])
  })

  it('logs to the console by default', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    createEnvWarner()('k', 'hello')
    expect(spy).toHaveBeenCalledWith('hello')
    spy.mockRestore()
  })
})

describe('production mode', () => {
  it.each([
    [undefined, false, false],
    ['', false, false],
    ['false', false, false],
    ['FALSE', false, false],
    ['true', true, false],
    ['TRUE', true, false],
    ['1', true, true],
    ['yes', true, true],
  ])('classifies %s', (value, production, invalid) => {
    const env = value === undefined ? {} : { PRODUCTION: value }
    expect(isProductionMode(env)).toBe(production)
    expect(isProductionValueInvalid(env)).toBe(invalid)
  })

  it('warns once about ambiguous values only', () => {
    const { log, warn } = setup()
    warnIfProductionValueInvalid(warn, { PRODUCTION: 'true' })
    expect(log.error).not.toHaveBeenCalled()
    warnIfProductionValueInvalid(warn, { PRODUCTION: 'yes' })
    warnIfProductionValueInvalid(warn, { PRODUCTION: 'yes' })
    expect(log.error).toHaveBeenCalledTimes(1)
    expect(log.error.mock.calls[0]?.[0]).toContain("'yes'")
  })
})

describe('secrets', () => {
  const secret = {
    name: 'WORKER_SECRET',
    minLength: 8,
    missingConsequence: 'origin requests will be rejected',
  }

  it('validates length', () => {
    expect(isSecretValid(undefined, 4)).toBe(false)
    expect(isSecretValid('abc', 4)).toBe(false)
    expect(isSecretValid('abcd', 4)).toBe(true)
  })

  it('warns once when missing, with the generation hint', () => {
    const { log, warn } = setup()
    warnIfSecretMisconfigured(warn, { ...secret, value: '' })
    warnIfSecretMisconfigured(warn, { ...secret, value: undefined })
    expect(log.error).toHaveBeenCalledTimes(1)
    expect(log.error.mock.calls[0]?.[0]).toBe(
      'WORKER_SECRET is not set or empty — origin requests will be rejected; generate with: openssl rand -hex 32',
    )
  })

  it('warns once when too short and falls back to the missing consequence', () => {
    const { log, warn } = setup()
    warnIfSecretMisconfigured(warn, { ...secret, value: 'short', generateHint: 'make one' })
    warnIfSecretMisconfigured(warn, { ...secret, value: 'short' })
    expect(log.error).toHaveBeenCalledTimes(1)
    expect(log.error.mock.calls[0]?.[0]).toBe(
      'WORKER_SECRET is too short (minimum 8 characters) — origin requests will be rejected; generate with: make one',
    )
  })

  it('uses a dedicated short consequence and stays quiet for valid secrets', () => {
    const { log, warn } = setup()
    warnIfSecretMisconfigured(warn, { ...secret, value: 'long-enough' })
    expect(log.error).not.toHaveBeenCalled()
    warnIfSecretMisconfigured(warn, { ...secret, value: 'short', shortConsequence: 'guessable' })
    expect(log.error.mock.calls[0]?.[0]).toContain('— guessable;')
  })
})

describe('asset origin and DSN warnings', () => {
  it('warns about invalid asset origins only', () => {
    const { log, warn } = setup()
    warnIfAssetOriginInvalid(warn, 'ASSET_ORIGIN')
    warnIfAssetOriginInvalid(warn, 'ASSET_ORIGIN', '  ')
    warnIfAssetOriginInvalid(warn, 'ASSET_ORIGIN', 'https://cdn.example.com')
    expect(log.error).not.toHaveBeenCalled()
    warnIfAssetOriginInvalid(warn, 'ASSET_ORIGIN', 'ftp://nope')
    expect(log.error.mock.calls[0]?.[0]).toContain('ASSET_ORIGIN failed validation')
  })

  it('warns about missing required and malformed DSNs', () => {
    const { log, warn } = setup()
    const valid = 'https://abc@o1.ingest.sentry.io/123'
    warnIfDsnInvalid(warn, { name: 'DSN_A', value: valid, required: true })
    warnIfDsnInvalid(warn, { name: 'DSN_B', value: undefined })
    expect(log.warn).not.toHaveBeenCalled()
    warnIfDsnInvalid(warn, { name: 'DSN_C', value: undefined, required: true })
    warnIfDsnInvalid(warn, { name: 'DSN_D', value: 'nope' })
    expect(log.warn.mock.calls).toEqual([
      ['DSN_C is missing or not a valid Sentry DSN'],
      ['DSN_D is missing or not a valid Sentry DSN'],
    ])
  })
})

describe('parseSentryDsn', () => {
  it('parses canonical DSNs', () => {
    expect(parseSentryDsn(' https://abc@o1.ingest.sentry.io/123 ')).toEqual({
      dsn: 'https://abc@o1.ingest.sentry.io/123',
      envelopeUrl: 'https://o1.ingest.sentry.io/api/123/envelope/',
      origin: 'https://o1.ingest.sentry.io',
      projectId: '123',
    })
    expect(parseSentryDsn('https://abc@sentry.example.com/relay/45')).toMatchObject({
      envelopeUrl: 'https://sentry.example.com/relay/api/45/envelope/',
      projectId: '45',
    })
  })

  it.each([
    undefined,
    '',
    'nope',
    'http://abc@host/1',
    'https://host/1',
    'https://a-b@host/1',
    'https://abc:secret@host/1',
    'https://abc@host/1?x=1',
    'https://abc@host/1#h',
    'https://abc@host/',
    'https://abc@host/project',
    'https://abc@host//1',
  ])('rejects %s', (raw) => {
    expect(parseSentryDsn(raw)).toBeUndefined()
  })
})
