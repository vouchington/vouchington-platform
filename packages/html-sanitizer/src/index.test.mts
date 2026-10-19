import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HTML_SANITIZE_POLICY,
  HTML_FRAGMENT_VOID_TAGS,
  htmlFragmentToPlainText,
  isSafeUrl,
  sanitizeHtmlFragment,
  sanitizeHtmlFragmentDemotingHeadings,
} from './index.mts'

const linkSchemes = new Set(['http', 'https', 'mailto', 'tel'])

describe('sanitizeHtmlFragment', () => {
  it('preserves expected prose HTML', () => {
    const html = sanitizeHtmlFragment(
      '<h1>Title</h1><p class="body" title="Name" data-kind="post" aria-label="Body"><a href="https://example.com" rel="noopener" target="_blank">link</a><img src="/sideload/abc?w=1200" alt="Photo" width="10" height="20" loading="lazy" decoding="async" fetchpriority="low"></p>',
    )

    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('class="body"')
    expect(html).toContain('title="Name"')
    expect(html).toContain('data-kind="post"')
    expect(html).toContain('aria-label="Body"')
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('src="/sideload/abc?w=1200"')
    expect(html).toContain('alt="Photo"')
    expect(html).toContain('width="10"')
    expect(html).toContain('height="20"')
    expect(html).toContain('loading="lazy"')
    expect(html).toContain('decoding="async"')
    expect(html).toContain('fetchpriority="low"')
  })

  it('drops dangerous tags, comments, and doctypes', () => {
    expect(
      sanitizeHtmlFragment(
        '<p>Safe</p><!-- secret --><!DOCTYPE html><script>alert(1)</script><style>body{color:red}</style><iframe src="https://example.com"></iframe><svg><text>s</text></svg><math><mi>m</mi></math><template><p>hidden</p></template>',
      ),
    ).toBe('<p>Safe</p>')
    expect(sanitizeHtmlFragment('a<!-- hidden -->b')).toBe('ab')
    expect(sanitizeHtmlFragment('<!DOCTYPE html><p>Hi</p>')).toBe('<p>Hi</p>')
  })

  it('unwraps unknown tags while preserving safe text content', () => {
    expect(sanitizeHtmlFragment('<custom><strong>Safe</strong></custom>')).toBe(
      '<strong>Safe</strong>',
    )
  })

  it('strips inline styles, ids, event handlers, and unsupported attributes', () => {
    expect(
      sanitizeHtmlFragment(
        '<p class="body" id="content" style="color:red" onclick="alert(1)" nonce="abc">Hello</p><a download href="https://example.com">x</a><details class="d" name="n">t</details><table><tr><td headers="h">c</td><th abbr="a">h</th></tr></table><img srcset="/a.png" alt="a">',
      ),
    ).toBe(
      '<p class="body">Hello</p><a href="https://example.com">x</a><details class="d">t</details><table><tbody><tr><td>c</td><th>h</th></tr></tbody></table><img alt="a">',
    )
  })

  it('escapes attribute values and lowercases names', () => {
    expect(sanitizeHtmlFragment('<p title="&amp;&quot;&lt;">x</p>')).toBe(
      '<p title="&amp;&quot;&lt;">x</p>',
    )
    expect(sanitizeHtmlFragment('<a HREF="https://example.com" TARGET="_blank">x</a>')).toBe(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer">x</a>',
    )
  })

  it('adds and merges rel tokens on blank-target links', () => {
    expect(sanitizeHtmlFragment('<a href="https://example.com" target=" _blank ">link</a>')).toBe(
      '<a href="https://example.com" target=" _blank " rel="noopener noreferrer">link</a>',
    )
    expect(
      sanitizeHtmlFragment(
        '<a href="https://example.com" target="_blank" rel="nofollow noopener">x</a>',
      ),
    ).toBe('<a href="https://example.com" target="_blank" rel="nofollow noopener noreferrer">x</a>')
    expect(
      sanitizeHtmlFragment(
        '<a href="https://example.com" target="_blank" rel="noopener noopener">x</a>',
      ),
    ).toBe('<a href="https://example.com" target="_blank" rel="noopener noreferrer">x</a>')
    expect(
      sanitizeHtmlFragment('<a href="https://example.com" target="_blank" rel=" noopener">x</a>'),
    ).toBe('<a href="https://example.com" target="_blank" rel="noopener noreferrer">x</a>')
  })

  it('leaves non-blank targets and non-link targets alone', () => {
    expect(
      sanitizeHtmlFragment('<a href="https://example.com" target="_self" rel="nofollow">x</a>'),
    ).toBe('<a href="https://example.com" target="_self" rel="nofollow">x</a>')
    expect(sanitizeHtmlFragment('<a href="https://example.com">x</a>')).toBe(
      '<a href="https://example.com">x</a>',
    )
    expect(sanitizeHtmlFragment('<div class="x" target="_blank">t</div>')).toBe(
      '<div class="x">t</div>',
    )
  })

  it('preserves safe disclosure and table structure attributes', () => {
    expect(
      sanitizeHtmlFragment(
        '<details open><summary>More</summary></details><table><tr><td colspan="2" rowspan="3">Cell</td></tr></table>',
      ),
    ).toBe(
      '<details open=""><summary>More</summary></details><table><tbody><tr><td colspan="2" rowspan="3">Cell</td></tr></tbody></table>',
    )
  })

  it('strips unsafe link and image URLs', () => {
    const html = sanitizeHtmlFragment(
      '<a href="javascript:alert(1)">bad</a><a href="mailto:tests+test@example.com">mail</a><img src="data:image/png;base64,abc" alt="bad"><img src="https://example.com/photo.jpg" alt="safe">',
    )

    expect(html).toContain('<a>bad</a>')
    expect(html).toContain('<a href="mailto:tests+test@example.com">mail</a>')
    expect(html).toContain('<img alt="bad">')
    expect(html).toContain('<img src="https://example.com/photo.jpg" alt="safe">')
  })

  it('strips protocol-relative, malformed, and whitespace-obfuscated URL schemes', () => {
    expect(
      sanitizeHtmlFragment(
        '<a href="//example.com">protocol</a><a href="1bad:thing">malformed</a><a href="java&#x0a;script:alert(1)">entity</a><img src="java\tscript:alert(1)" alt="bad">',
      ),
    ).toBe('<a>protocol</a><a>malformed</a><a>entity</a><img alt="bad">')
  })

  it('preserves relative URLs that contain colons after a slash', () => {
    expect(
      sanitizeHtmlFragment(
        '<a href="/docs/path:section">root relative</a><a href="docs/path:section">relative</a><a href="/search?q=a:b">query</a><a href="/docs#section:2">hash</a><img src="/images/path:asset.png" alt="safe">',
      ),
    ).toBe(
      '<a href="/docs/path:section">root relative</a><a href="docs/path:section">relative</a><a href="/search?q=a:b">query</a><a href="/docs#section:2">hash</a><img src="/images/path:asset.png" alt="safe">',
    )
  })

  it('applies each policy override and keeps the other defaults', () => {
    const defaults = DEFAULT_HTML_SANITIZE_POLICY
    expect(
      sanitizeHtmlFragment('<p>a</p><strong>b</strong>', { allowedTags: new Set(['p']) }),
    ).toBe('<p>a</p>b')
    expect(sanitizeHtmlFragment('<p>a</p><em>x</em>', { dangerousTags: new Set(['em']) })).toBe(
      '<p>a</p>',
    )
    expect(
      sanitizeHtmlFragment('<p id="x" class="c">a</p>', {
        isAllowedAttribute: (tag, name) => name === 'id' || defaults.isAllowedAttribute(tag, name),
      }),
    ).toBe('<p id="x" class="c">a</p>')
    expect(
      sanitizeHtmlFragment(
        '<a href="http://example.com">x</a><a href="https://example.com">y</a>',
        {
          linkSchemes: new Set(['https']),
        },
      ),
    ).toBe('<a>x</a><a href="https://example.com">y</a>')
    expect(
      sanitizeHtmlFragment('<img src="https://example.com/a.png" alt="a">', {
        imageSchemes: new Set(),
      }),
    ).toBe('<img alt="a">')
    expect(HTML_FRAGMENT_VOID_TAGS.has('br')).toBe(true)
  })
})

describe('sanitizeHtmlFragmentDemotingHeadings', () => {
  it('demotes headings, clamps at h6, and skips hr, hx, and h9', () => {
    const allowedTags = new Set([...DEFAULT_HTML_SANITIZE_POLICY.allowedTags, 'hx', 'h9'])
    expect(
      sanitizeHtmlFragmentDemotingHeadings(
        '<h1 onclick="alert(1)">Top</h1><p data-example="<h1>">Attr</p><div><h2>Nested</h2><em>e</em></div><hr><hx>nope</hx><h9>nine</h9><h5>A</h5><h6>B</h6>',
        { policy: { allowedTags } },
      ),
    ).toBe(
      '<h3>Top</h3><p data-example="&lt;h1>">Attr</p><div><h4>Nested</h4><em>e</em></div><hr><hx>nope</hx><h9>nine</h9><h6>A</h6><h6>B</h6>',
    )
  })

  it('uses the default offset when options omit it', () => {
    expect(sanitizeHtmlFragmentDemotingHeadings('<h1>T</h1>')).toBe('<h3>T</h3>')
    expect(sanitizeHtmlFragmentDemotingHeadings('<h1>T</h1>', {})).toBe('<h3>T</h3>')
  })

  it('keeps heading levels when the offset is 0', () => {
    expect(sanitizeHtmlFragmentDemotingHeadings('<h1>T</h1>', { headingOffset: 0 })).toBe(
      '<h1>T</h1>',
    )
  })

  it('returns null, undefined, and empty input unchanged', () => {
    expect(sanitizeHtmlFragmentDemotingHeadings(null)).toBeNull()
    expect(sanitizeHtmlFragmentDemotingHeadings(undefined)).toBeUndefined()
    expect(sanitizeHtmlFragmentDemotingHeadings('')).toBe('')
  })
})

describe('htmlFragmentToPlainText', () => {
  it('extracts text with entity decoding, void tags, and collapsed spaces', () => {
    expect(htmlFragmentToPlainText('<p>Doctor&#8217;s note &amp; more</p><p>Next</p>')).toBe(
      'Doctor\u2019s note & more Next',
    )
    expect(htmlFragmentToPlainText('a&nbsp;&nbsp;b')).toBe('a b')
    expect(htmlFragmentToPlainText('<p>Hello<br>world</p><p>A<img alt="x">B</p>')).toBe(
      'Hello world A B',
    )
  })

  it('handles quoted angle brackets and malformed HTML through the parser', () => {
    expect(htmlFragmentToPlainText('<img alt=">" src="x"><p>Hello <strong>world</p>')).toBe(
      'Hello world',
    )
  })

  it('drops dangerous tag contents, comments, and doctypes', () => {
    expect(
      htmlFragmentToPlainText('<p>Safe</p><script>alert(1)</script><!-- n --><!DOCTYPE html>'),
    ).toBe('Safe')
  })

  it('uses an injected dangerous-tag set', () => {
    expect(htmlFragmentToPlainText('<p>A<em>B</em></p>', { dangerousTags: new Set(['em']) })).toBe(
      'A',
    )
  })
})

describe('isSafeUrl', () => {
  it('rejects empty, whitespace, and scheme-relative values', () => {
    expect(isSafeUrl('', linkSchemes)).toBe(false)
    expect(isSafeUrl('   ', linkSchemes)).toBe(false)
    expect(isSafeUrl('//x', linkSchemes)).toBe(false)
    expect(isSafeUrl('  //x', linkSchemes)).toBe(false)
  })

  it('allows relative values, including a colon after a separator', () => {
    expect(isSafeUrl('docs/path', linkSchemes)).toBe(true)
    expect(isSafeUrl(' /docs ', linkSchemes)).toBe(true)
    expect(isSafeUrl('/docs/path:section', linkSchemes)).toBe(true)
    expect(isSafeUrl('/search?q=a:b', linkSchemes)).toBe(true)
    expect(isSafeUrl('/docs#section:2', linkSchemes)).toBe(true)
    expect(isSafeUrl('?q=a:b', linkSchemes)).toBe(true)
    expect(isSafeUrl('#a:b', linkSchemes)).toBe(true)
  })

  it('allows only well-formed schemes from the supplied set', () => {
    expect(isSafeUrl('https://example.com', linkSchemes)).toBe(true)
    expect(isSafeUrl('HTTPS://example.com', linkSchemes)).toBe(true)
    expect(isSafeUrl('https:alert(1)', linkSchemes)).toBe(true)
    expect(isSafeUrl('mailto:a@example.com', linkSchemes)).toBe(true)
    expect(isSafeUrl('JaVa\tScript:alert(1)', linkSchemes)).toBe(false)
    expect(isSafeUrl('1bad:thing', linkSchemes)).toBe(false)
    expect(isSafeUrl(':foo', linkSchemes)).toBe(false)
    expect(isSafeUrl('ftp://example.com', linkSchemes)).toBe(false)
    expect(isSafeUrl('ftp://example.com', new Set(['http', 'https']))).toBe(false)
  })
})
