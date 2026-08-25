import { describe, expect, it } from 'vitest'
import { decodeHtmlEntities, escapeHtml, isInsideHtmlTag } from './index.mts'

describe('HTML entity and text helpers', () => {
  it('escapes HTML and XML text contexts', () => {
    expect(escapeHtml(`& < > " '`)).toBe('&amp; &lt; &gt; &quot; &#39;')
  })
  it('decodes strict named and numeric entities while preserving invalid numerics', () => {
    expect(decodeHtmlEntities('plain')).toBe('plain')
    expect(decodeHtmlEntities('NASA&#8217;s &amp; &#x2122;')).toBe('NASA’s & ™')
    expect(decodeHtmlEntities('&#65;')).toBe('A')
    expect(decodeHtmlEntities('&#xD800;')).toBe('&#xD800;')
    expect(decodeHtmlEntities('\u0000html-entity-0\u0000 &#xD800;')).toBe(
      '\u0000html-entity-0\u0000 &#xD800;',
    )
  })
  it('recognizes positions within completed tags only', () => {
    expect(isInsideHtmlTag('<a href="x">', 5)).toBe(true)
    expect(isInsideHtmlTag('<unfinished', 5)).toBe(false)
    expect(isInsideHtmlTag('<a>hello', 5)).toBe(false)
    expect(isInsideHtmlTag('plain', 2)).toBe(false)
  })
})
