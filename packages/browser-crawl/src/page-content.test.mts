import { afterEach, describe, expect, it, vi } from 'vitest'
import { measureAndSerializePage } from './page-content.mts'

describe('measureAndSerializePage', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('rejects oversized DOM text before reading outerHTML', () => {
    let outerHtmlReads = 0
    const root = element('HTML', [element('BODY', [text('unbounded page text')])])
    Object.defineProperty(root, 'outerHTML', {
      get() {
        outerHtmlReads += 1
        return '<html><body>unbounded page text</body></html>'
      },
    })
    vi.stubGlobal('document', { documentElement: root })

    expect(measureAndSerializePage({ maxHtmlBytes: 16, maxTitleBytes: 1024 })).toEqual({
      contentLength: expect.any(Number),
      html: undefined,
      title: '',
    })
    expect(outerHtmlReads).toBe(0)
  })

  it('counts visible body text without head, script, or template content', () => {
    const template = element('TEMPLATE')
    template.content = { childNodes: [text('template text')] }
    const body = element('BODY', [
      text('visible'),
      element('SCRIPT', [text('script text')]),
      template,
    ])
    body.innerText = 'visible'
    const root = element('HTML', [element('HEAD', [text('head text')]), body])
    root.outerHTML = '<html><head>x</head><body>visible<script>x</script></body></html>'
    vi.stubGlobal('document', { documentElement: root })

    expect(measureAndSerializePage({ maxHtmlBytes: 1024, maxTitleBytes: 1024 })).toEqual({
      contentLength: 7,
      html: root.outerHTML,
      title: '',
    })
  })

  it('uses rendered body text semantics for whitespace and hidden descendants', () => {
    const hidden = element('DIV', [text('hidden content'.repeat(10))])
    const body = element('BODY', [text(' '.repeat(100)), hidden])
    body.innerText = ''
    const root = element('HTML', [body])
    root.outerHTML = '<html><body>   <div hidden>hidden content</div></body></html>'
    vi.stubGlobal('document', { documentElement: root })

    expect(
      measureAndSerializePage({ maxContentLength: 50, maxHtmlBytes: 1024, maxTitleBytes: 1024 }),
    ).toMatchObject({ contentLength: 0 })
  })

  it('keeps counting body text after oversized head markup stops serialization', () => {
    let outerHtmlReads = 0
    const body = element('BODY', [text('visible body'.repeat(10))])
    body.innerText = 'visible body'.repeat(10)
    const root = element('HTML', [
      element('HEAD', [element('SCRIPT', [text('oversized script')])]),
      body,
    ])
    Object.defineProperty(root, 'outerHTML', {
      get() {
        outerHtmlReads += 1
        return ''
      },
    })
    vi.stubGlobal('document', { documentElement: root })

    expect(
      measureAndSerializePage({
        maxContentLength: 50,
        maxHtmlBytes: 20,
        maxTitleBytes: 1024,
      }),
    ).toEqual({
      contentLength: 50,
      html: undefined,
      title: '',
    })
    expect(outerHtmlReads).toBe(0)
  })

  it('bounds post-cap traversal when an oversized document has no body text', () => {
    let outerHtmlReads = 0
    const root = element('HTML', [element('HEAD', [text('x'.repeat(40))]), element('BODY')])
    Object.defineProperty(root, 'outerHTML', {
      get() {
        outerHtmlReads += 1
        return ''
      },
    })
    vi.stubGlobal('document', { documentElement: root })

    expect(
      measureAndSerializePage({
        maxContentLength: 50,
        maxHtmlBytes: 20,
        maxTitleBytes: 1024,
        maxTraversalWork: 40,
      }),
    ).toEqual({ contentLength: 50, html: undefined, title: '' })
    expect(outerHtmlReads).toBe(0)
  })

  it('bounds traversal even when hostile nodes add no serialized bytes', () => {
    let outerHtmlReads = 0
    const root = element('HTML', [element('BODY', wideChildren(40, ''))])
    Object.defineProperty(root, 'outerHTML', {
      get() {
        outerHtmlReads += 1
        return ''
      },
    })
    vi.stubGlobal('document', { documentElement: root })

    expect(
      measureAndSerializePage({
        maxContentLength: 50,
        maxHtmlBytes: 100_000,
        maxTitleBytes: 1024,
        maxTraversalWork: 40,
      }),
    ).toEqual({ contentLength: 50, html: undefined, title: '' })
    expect(outerHtmlReads).toBe(0)
  })

  it('stops reading attributes as soon as traversal work is exhausted', () => {
    let attributeReads = 0
    let outerHtmlReads = 0
    const body = element('BODY')
    body.attributes = new Proxy({ length: 2 } as ArrayLike<{ name: string; value: string }>, {
      get(target, property) {
        if (property === 'length') return target.length
        attributeReads += 1
        return { name: `data-${String(property)}`, value: 'value' }
      },
    })
    const root = element('HTML', [body])
    Object.defineProperty(root, 'outerHTML', {
      get() {
        outerHtmlReads += 1
        return ''
      },
    })
    vi.stubGlobal('document', { documentElement: root })

    expect(
      measureAndSerializePage({
        maxContentLength: 50,
        maxHtmlBytes: 100_000,
        maxTitleBytes: 1024,
        maxTraversalWork: 20,
      }),
    ).toEqual({ contentLength: 50, html: undefined, title: '' })
    expect(attributeReads).toBe(1)
    expect(outerHtmlReads).toBe(0)
  })

  it('checks the serializer output byte length before returning it', () => {
    const root = element('HTML')
    root.outerHTML = '<html>😊</html>'
    vi.stubGlobal('document', { documentElement: root })

    expect(
      measureAndSerializePage({
        maxHtmlBytes: Buffer.byteLength(root.outerHTML) - 1,
        maxTitleBytes: 1024,
      }).html,
    ).toBeUndefined()
    expect(
      measureAndSerializePage({
        maxHtmlBytes: Buffer.byteLength(root.outerHTML),
        maxTitleBytes: 1024,
      }).html,
    ).toBe(root.outerHTML)
  })

  it('treats a throwing outerHTML getter as an omitted optional snapshot', () => {
    const body = element('BODY', [text('visible')])
    body.innerText = 'visible'
    const root = element('HTML', [body])
    Object.defineProperty(root, 'outerHTML', {
      get() {
        throw new Error('hostile getter')
      },
    })
    vi.stubGlobal('document', { documentElement: root, title: 'Page title' })

    expect(measureAndSerializePage({ maxHtmlBytes: 1024, maxTitleBytes: 1024 })).toEqual({
      contentLength: 7,
      html: undefined,
      title: 'Page title',
    })
  })

  it('limits title bytes before returning page data over CDP', () => {
    const root = element('HTML')
    root.outerHTML = '<html></html>'
    vi.stubGlobal('document', { documentElement: root, title: 'ab😊cd' })

    expect(measureAndSerializePage({ maxHtmlBytes: 1024, maxTitleBytes: 5 }).title).toBe('ab')
  })

  it('walks a wide DOM without allocating a sibling-sized traversal stack', () => {
    const body = element('BODY', wideChildren(100_000))
    body.innerText = 'x'.repeat(100_000)
    const root = element('HTML', [body])
    root.outerHTML = '<html><body></body></html>'
    vi.stubGlobal('document', { documentElement: root })

    expect(
      measureAndSerializePage({ maxHtmlBytes: 200_000, maxTitleBytes: 1024 }).contentLength,
    ).toBe(100_000)
  })

  it('rejects escaped attribute bytes before reading outerHTML', () => {
    let outerHtmlReads = 0
    const body = element('BODY')
    body.attributes = [{ name: 'data-value', value: '&' }]
    const root = element('HTML', [body])
    Object.defineProperty(root, 'outerHTML', {
      get() {
        outerHtmlReads += 1
        return ''
      },
    })
    vi.stubGlobal('document', { documentElement: root })

    expect(measureAndSerializePage({ maxHtmlBytes: 29, maxTitleBytes: 1024 }).html).toBeUndefined()
    expect(outerHtmlReads).toBe(0)
  })

  it('rejects comment bytes before reading outerHTML', () => {
    let outerHtmlReads = 0
    const root = element('HTML', [
      element('BODY', [{ nodeType: 8, nodeValue: 'note', childNodes: [] }]),
    ])
    Object.defineProperty(root, 'outerHTML', {
      get() {
        outerHtmlReads += 1
        return ''
      },
    })
    vi.stubGlobal('document', { documentElement: root })

    expect(measureAndSerializePage({ maxHtmlBytes: 30, maxTitleBytes: 1024 }).html).toBeUndefined()
    expect(outerHtmlReads).toBe(0)
  })

  it('returns an empty measurement without a document element', () => {
    vi.stubGlobal('document', {})
    expect(measureAndSerializePage({ maxHtmlBytes: 1, maxTitleBytes: 1 })).toEqual({
      contentLength: 0,
      html: undefined,
      title: '',
    })
  })

  it('counts escaped and multibyte serialized bytes exactly', () => {
    const build = () => {
      const root = element('HTML', [
        text('&<>éह'),
        { nodeType: 3, nodeValue: null, childNodes: [] },
        { nodeType: 8, nodeValue: null, childNodes: [] },
      ])
      root.attributes = [{ name: 'a', value: '&"<x' }]
      root.outerHTML = '<html></html>'
      return root
    }
    // <HTML a="&amp;&quot;&lt;x"> is 30 bytes, the text 20, the empty comment 7 and </HTML> 7.
    vi.stubGlobal('document', { documentElement: build() })
    expect(measureAndSerializePage({ maxHtmlBytes: 64, maxTitleBytes: 1 }).html).toBe(
      '<html></html>',
    )
    vi.stubGlobal('document', { documentElement: build() })
    expect(measureAndSerializePage({ maxHtmlBytes: 63, maxTitleBytes: 1 }).html).toBeUndefined()
  })

  it('counts script and style text as raw, unescaped bytes', () => {
    const build = () => {
      const root = element('HTML', [element('script', [text('&&&&')]), element('P', [text('&')])])
      root.outerHTML = '<html></html>'
      return root
    }
    // <HTML> 6, <script>&&&&</script> 21, <P>&amp;</P> 12, </HTML> 7: 46 bytes.
    vi.stubGlobal('document', { documentElement: build() })
    expect(measureAndSerializePage({ maxHtmlBytes: 46, maxTitleBytes: 1 }).html).toBe(
      '<html></html>',
    )
    vi.stubGlobal('document', { documentElement: build() })
    expect(measureAndSerializePage({ maxHtmlBytes: 45, maxTitleBytes: 1 }).html).toBeUndefined()
  })

  it('counts void elements without children or an end tag', () => {
    const build = () => {
      const root = element('HTML', [element('br', [text('ignored')]), element('IMG')])
      root.outerHTML = '<html></html>'
      return root
    }
    // <HTML> 6, <br> 4, <IMG> 5, </HTML> 7: 22 bytes.
    vi.stubGlobal('document', { documentElement: build() })
    expect(measureAndSerializePage({ maxHtmlBytes: 22, maxTitleBytes: 1 }).html).toBe(
      '<html></html>',
    )
    vi.stubGlobal('document', { documentElement: build() })
    expect(measureAndSerializePage({ maxHtmlBytes: 21, maxTitleBytes: 1 }).html).toBeUndefined()
  })

  it('counts supplementary text and ignores unknown nodes', () => {
    const body = element('BODY', [
      text('a😊'),
      { nodeType: 7, nodeValue: 'ignored', childNodes: [] },
    ])
    body.innerText = 'a😊'
    const root = element('HTML', [body])
    root.outerHTML = '<html><body>a😊</body></html>'
    vi.stubGlobal('document', { documentElement: root })

    expect(measureAndSerializePage({ maxHtmlBytes: 1024, maxTitleBytes: 1024 })).toEqual({
      contentLength: 3,
      html: root.outerHTML,
      title: '',
    })
  })
})

type TestNode = {
  nodeType: number
  nodeValue: string | null
  childNodes: TestNode[]
  tagName?: string
  attributes?: ArrayLike<{ name: string; value: string }>
  content?: { childNodes: TestNode[] }
  innerText?: string
  outerHTML?: string
}

function text(nodeValue: string): TestNode {
  return { nodeType: 3, nodeValue, childNodes: [] }
}

function element(tagName: string, childNodes: TestNode[] = []): TestNode {
  return { nodeType: 1, nodeValue: null, childNodes, tagName, attributes: [], outerHTML: '' }
}

function wideChildren(count: number, nodeValue = 'x'): TestNode[] {
  return Array.from({ length: count }, () => text(nodeValue))
}
