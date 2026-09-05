import { describe, expect, it } from 'vitest'
import {
  decodeHtmlEntities,
  escapeHtml,
  escapeInlineScriptJson,
  isInsideCode,
  isInsideHtmlElement,
  isInsideHtmlTag,
} from './index.mts'

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
  it('normalizes only caller-selected named entities case-insensitively', () => {
    const options = { caseInsensitiveNamedEntities: ['amp', 'mdash', 'frac12', 'AElig'] }
    expect(decodeHtmlEntities('&AMP; &mDash; &FRAC12; &aElIg; &NBSP; &Aacute;', options)).toBe(
      '& — ½ Æ &NBSP; Á',
    )
    expect(decodeHtmlEntities('&MDASH;')).toBe('&MDASH;')
  })
  it('recognizes positions inside caller-selected elements', () => {
    expect(isInsideHtmlElement('<code>hello', 8, ['code', 'pre'])).toBe(true)
    expect(isInsideHtmlElement('<code>hello</code>', 18, ['code', 'pre'])).toBe(false)
    expect(isInsideHtmlElement('<pre class="x">hello', 16, ['code', 'pre'])).toBe(true)
    expect(isInsideHtmlElement('<CODE>hello', 8, ['code'])).toBe(false)
    expect(isInsideHtmlElement('<codepen>hello', 10, ['code'])).toBe(false)
    expect(isInsideHtmlElement('<custom.name>hello', 14, ['custom.name'])).toBe(true)
    expect(isInsideHtmlElement('<code>hello', 8, [''])).toBe(false)
    expect(isInsideHtmlElement('<code><code></code>hello</code>', 24, ['code'])).toBe(true)
    expect(isInsideHtmlElement('<code/><pre>hello', 12, ['code'])).toBe(false)
    expect(isInsideHtmlElement('<code>hello', 3, ['code'])).toBe(false)
  })
  it('recognizes positions inside code or pre via isInsideCode', () => {
    expect(isInsideCode('<code>hello', 8)).toBe(true)
    expect(isInsideCode('<code>hi</code> hello', 20)).toBe(false)
    expect(isInsideCode('<pre>hi', 6)).toBe(true)
    expect(isInsideCode('<pre>hi</pre> hello', 18)).toBe(false)
    expect(isInsideCode('hello world', 5)).toBe(false)
  })
  it('escapes inline-script JSON breakout characters', () => {
    expect(escapeInlineScriptJson('{"key":"value"}')).toBe('{"key":"value"}')
    expect(escapeInlineScriptJson('')).toBe('')
    const lineSeparator = String.fromCodePoint(0x20_28)
    const paragraphSeparator = String.fromCodePoint(0x20_29)
    expect(escapeInlineScriptJson(`{"test":"<${lineSeparator}${paragraphSeparator}"}`)).toBe(
      String.raw`{"test":"\u003c\u2028\u2029"}`,
    )
    expect(escapeInlineScriptJson('<<<')).toBe(String.raw`\u003c\u003c\u003c`)
  })
})
