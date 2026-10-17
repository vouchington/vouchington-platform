import { describe, expect, it } from 'vitest'

import { createSpeculationRules, getPreconnectOrigin } from './speculation-rules.mts'

describe('createSpeculationRules', () => {
  it('builds exclusions and defaults', () => {
    const rules = createSpeculationRules({ excludedHrefPatterns: ['/api/*'] })
    expect(rules).toEqual({
      prefetch: [
        {
          source: 'document',
          where: { and: [{ href_matches: '/*' }, { not: { href_matches: '/api/*' } }] },
          eagerness: 'conservative',
        },
      ],
    })
  })

  it('supports selectors, eagerness and no-vary-search', () => {
    const rules = createSpeculationRules({
      excludedHrefPatterns: [],
      excludedSelectors: ['a[download]'],
      noVarySearchHeader: 'params',
      eagerness: 'moderate',
    })
    expect(rules).toEqual({
      prefetch: [
        {
          source: 'document',
          where: { and: [{ href_matches: '/*' }, { not: { selector_matches: 'a[download]' } }] },
          eagerness: 'moderate',
          expects_no_vary_search: 'params',
        },
      ],
    })
  })
})

describe('getPreconnectOrigin', () => {
  it('returns origins for http(s) urls only', () => {
    expect(getPreconnectOrigin(' https://cdn.example.com/a ')).toBe('https://cdn.example.com')
    expect(getPreconnectOrigin('http://x.test')).toBe('http://x.test')
    expect(getPreconnectOrigin('ftp://x.test')).toBeNull()
    expect(getPreconnectOrigin('nope')).toBeNull()
    expect(getPreconnectOrigin('  ')).toBeNull()
    expect(getPreconnectOrigin(undefined)).toBeNull()
  })
})
