import { describe, expect, it } from 'vitest'
import { createUtmParser } from './utm.mts'

describe('createUtmParser', () => {
  it('lowercases and trims sources without expanding empty aliases', () => {
    const parser = createUtmParser({ sourceAliases: {} })
    expect(parser.resolveSource(' IG ')).toBe('ig')
    expect(
      parser.extractFromUrl(new URL('https://example.com/?utm_source=IG&utm_medium=CPC')),
    ).toEqual({
      utmSource: 'ig',
      utmMedium: 'cpc',
      utmCampaign: null,
      utmContent: null,
    })
  })

  it('applies caller aliases and prefers utm_source over the fallback param', () => {
    const parser = createUtmParser({
      sourceAliases: { IG: 'Instagram', x: 'twitter' },
      fallbackSourceParam: 'ref',
    })
    expect(parser.resolveSource('ig')).toBe('instagram')
    expect(parser.extractFromUrl(new URL('https://example.com/?ref=fb')).utmSource).toBe('fb')
    expect(
      parser.extractFromUrl(new URL('https://example.com/?utm_source=google&ref=ig')).utmSource,
    ).toBe('google')
    expect(
      parser.extractFromUrl(
        new URL(
          'https://example.com/?utm_source=x&utm_medium=cpc&utm_campaign=Spring&utm_content=Banner',
        ),
      ),
    ).toEqual({
      utmSource: 'twitter',
      utmMedium: 'cpc',
      utmCampaign: 'spring',
      utmContent: 'banner',
    })
  })

  it('snapshots aliases so later caller mutation is ignored', () => {
    const sourceAliases = { ig: 'instagram' }
    const parser = createUtmParser({ sourceAliases })
    sourceAliases.ig = 'ignored'
    expect(parser.resolveSource('ig')).toBe('instagram')
  })

  it('returns nulls when no UTM or fallback params are present', () => {
    const parser = createUtmParser({ sourceAliases: { ig: 'instagram' } })
    expect(parser.extractFromUrl(new URL('https://example.com/'))).toEqual({
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      utmContent: null,
    })
  })

  it('treats whitespace-only fields as absent and can fall back', () => {
    const parser = createUtmParser({
      sourceAliases: { ig: 'instagram' },
      fallbackSourceParam: 'ref',
    })
    expect(
      parser.extractFromUrl(
        new URL('https://example.com/?utm_source=+++&utm_medium=+&utm_campaign=%20&utm_content='),
      ),
    ).toEqual({
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      utmContent: null,
    })
    expect(
      parser.extractFromUrl(new URL('https://example.com/?utm_source=+&ref=ig')).utmSource,
    ).toBe('instagram')
    expect(parser.extractFromUrl(new URL('https://example.com/?ref=+')).utmSource).toBeNull()
  })
})
