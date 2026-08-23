import { describe, expect, it } from 'vitest'
import { createClientInfoParser } from './request-client-info.mts'

const parse = createClientInfoParser({
  headers: {
    client: 'x-client',
    platform: 'x-platform',
    appVersion: 'x-version',
    sdkVersion: 'x-sdk',
  },
  clients: ['browser', 'native'] as const,
  platforms: ['web', 'mobile'] as const,
  compatiblePlatforms: { browser: ['web'], native: ['mobile'] },
})

describe('client info parser', () => {
  it('parses configured headers without product defaults', () => {
    expect(
      parse({ 'x-client': 'native', 'x-platform': 'mobile', 'x-version': '1.0', 'x-sdk': '2.0' }),
    ).toEqual({ client: 'native', platform: 'mobile', appVersion: '1.0', sdkVersion: '2.0' })
  })

  it('supports omitted optional metadata and caller-provided version rules', () => {
    expect(parse({ 'x-client': 'browser', 'x-platform': 'web', 'x-version': '1.0' })).toEqual({
      client: 'browser',
      platform: 'web',
      appVersion: '1.0',
    })
    const strict = createClientInfoParser({
      headers: { client: 'client', platform: 'platform', appVersion: 'version' },
      clients: ['client'] as const,
      platforms: ['platform'] as const,
      compatiblePlatforms: { client: ['platform'] },
      versionPattern: /^v\d+$/,
    })
    expect(strict({ client: 'client', platform: 'platform', version: 'v1' })).toBeDefined()
    expect(() => strict({ client: 'client', platform: 'platform', version: '1' })).toThrow(
      'invalid',
    )
    expect(() =>
      createClientInfoParser<string, string>({
        headers: { client: 'client', platform: 'platform', appVersion: 'version' },
        clients: ['client'] as const,
        platforms: ['platform'] as const,
        compatiblePlatforms: { client: ['platform'] },
        versionPattern: /v\\d+/g,
      }),
    ).toThrow('global')
  })

  it('rejects duplicate, invalid, incompatible, and malformed values', () => {
    expect(() => parse({})).toThrow('x-client is required')
    expect(() =>
      parse({ 'x-client': ['browser', 'native'], 'x-platform': 'web', 'x-version': '1' }),
    ).toThrow('exactly once')
    expect(() =>
      parse({ 'x-client': 'browser', 'x-platform': 'mobile', 'x-version': '1' }),
    ).toThrow('incompatible')
    expect(() => parse({ 'x-client': 'browser', 'x-platform': 'web', 'x-version': '\n' })).toThrow(
      'invalid',
    )
    expect(() => parse({ 'x-client': 'unknown', 'x-platform': 'web', 'x-version': '1' })).toThrow(
      'invalid',
    )
    expect(() =>
      parse({ 'x-client': 'browser', 'x-platform': 'unknown', 'x-version': '1' }),
    ).toThrow('invalid')
  })

  it('validates and copies client compatibility configuration', () => {
    expect(() =>
      createClientInfoParser<string, string>({
        headers: { client: 'client', platform: 'platform', appVersion: 'version' },
        clients: ['client'],
        platforms: ['platform'],
        compatiblePlatforms: {},
      }),
    ).toThrow('requires compatible platforms')
    expect(() =>
      createClientInfoParser({
        headers: { client: 'client', platform: 'platform', appVersion: 'version' },
        clients: ['client'],
        platforms: ['platform'],
        compatiblePlatforms: { client: ['unknown'] },
      }),
    ).toThrow('unknown compatible platform')

    const compatible: string[] = ['platform']
    const stable = createClientInfoParser({
      headers: { client: 'client', platform: 'platform', appVersion: 'version' },
      clients: ['client'],
      platforms: ['platform'],
      compatiblePlatforms: { client: compatible },
    })
    compatible.length = 0
    expect(stable({ client: 'client', platform: 'platform', version: '1' })).toBeDefined()
  })
})
