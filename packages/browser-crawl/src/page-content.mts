type PageNode = {
  nodeType: number
  nodeValue: string | null
  childNodes: ArrayLike<PageNode>
}

type PageElement = PageNode & {
  tagName: string
  attributes: ArrayLike<{ name: string; value: string }>
  content?: { childNodes: ArrayLike<PageNode> }
  innerText?: string
  outerHTML: string
}

type PageDocument = { documentElement?: PageElement }

// This function is passed to Playwright page.evaluate(), so it must remain self-contained.
export function measureAndSerializePage(limits: {
  maxContentLength?: number
  maxHtmlBytes: number
  maxTitleBytes: number
  maxTraversalWork?: number
}): {
  contentLength: number
  html?: string | undefined
  title: string
} {
  const {
    maxContentLength = Number.MAX_SAFE_INTEGER,
    maxHtmlBytes,
    maxTitleBytes,
    maxTraversalWork = Number.MAX_SAFE_INTEGER,
  } = limits
  // Named form controls and named document items shadow DOM properties (LegacyOverrideBuiltIns),
  // so read through the native prototype getters when they exist.
  const scope = globalThis as unknown as Record<string, { prototype: object } | undefined>
  const read = <T,>(target: object, type: string, name: string): T => {
    const prototype = scope[type]?.prototype
    // Reflect.get with a receiver runs the prototype's getter against the target.
    return Reflect.get(prototype && name in prototype ? prototype : target, name, target) as T
  }
  const doc = (globalThis as unknown as { document?: PageDocument }).document
  const getBoundedTitle = (): string => {
    // Only called once documentElement was found, so the document exists.
    const title = read<string | undefined>(doc!, 'Document', 'title') ?? ''
    const encoder = new TextEncoder()
    let bytes = 0
    let boundedTitle = ''
    for (const character of title) {
      const characterBytes = encoder.encode(character).byteLength
      if (bytes + characterBytes > maxTitleBytes) break
      bytes += characterBytes
      boundedTitle += character
    }
    return boundedTitle
  }
  const ELEMENT_NODE = 1
  const TEXT_NODE = 3
  const COMMENT_NODE = 8
  // outerHTML writes no children or end tag for these elements.
  const VOID_ELEMENTS =
    'AREA BASE BASEFONT BGSOUND BR COL EMBED FRAME HR IMG INPUT KEYGEN LINK META PARAM SOURCE TRACK WBR'.split(
      ' ',
    )
  // outerHTML writes these elements' text unescaped (the HTML fragment serialization algorithm).
  const RAW_TEXT_PARENTS = 'IFRAME NOEMBED NOFRAMES NOSCRIPT PLAINTEXT SCRIPT STYLE XMP'.split(' ')
  const root = doc ? read<PageElement | undefined>(doc, 'Document', 'documentElement') : undefined
  if (!root) return { contentLength: 0, html: undefined, title: '' }
  let contentLength = 0
  let serializedBytes = 0
  let omitHtml = false
  let traversalWork = 0
  let body: PageElement | undefined
  const add = (text: string, escape: 'text' | 'attribute' | 'none' = 'none') => {
    for (const char of text) {
      traversalWork += 1
      if (traversalWork >= maxTraversalWork) {
        contentLength = maxContentLength
        omitHtml = true
        return
      }
      if (omitHtml) continue
      // Entity lengths from the HTML serialization algorithm: &amp; &lt; &gt; &quot; &nbsp;.
      if (escape !== 'none' && (char === '&' || char === '\u00a0'))
        serializedBytes += char === '&' ? 5 : 6
      else if (escape === 'text' && (char === '<' || char === '>')) serializedBytes += 4
      else if (escape === 'attribute' && char === '"') serializedBytes += 6
      else {
        const codePoint = char.codePointAt(0)!
        serializedBytes +=
          codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4
      }
      if (serializedBytes > maxHtmlBytes) omitHtml = true
    }
  }
  const nodes: Array<{
    children?: ArrayLike<PageNode>
    index?: number
    node: PageNode
    rawText?: boolean | undefined
    rawTextParent?: boolean
    tagName?: string
  }> = [{ node: root }]
  while (nodes.length > 0) {
    traversalWork += 1
    if (traversalWork >= maxTraversalWork) {
      contentLength = maxContentLength
      omitHtml = true
      break
    }
    const current = nodes.at(-1)!
    const { node } = current
    if (current.children) {
      const index = current.index!
      if (index < current.children.length) {
        current.index = index + 1
        nodes.push({ node: current.children[index]!, rawText: current.rawTextParent })
        continue
      }
      add(`</${current.tagName}>`)
      nodes.pop()
      continue
    }
    const nodeType = read<number>(node, 'Node', 'nodeType')
    if (nodeType !== ELEMENT_NODE) {
      const value = read<string | null>(node, 'Node', 'nodeValue') ?? ''
      if (nodeType === TEXT_NODE) add(value, current.rawText ? 'none' : 'text')
      else if (nodeType === COMMENT_NODE) add(`<!--${value}-->`)
      // CDATA sections (4) and processing instructions (7) appear in XML and SVG documents.
      else if (nodeType === 4) add(`<![CDATA[${value}]]>`)
      else if (nodeType === 7) {
        add(`<?${read<string>(node, 'ProcessingInstruction', 'target')} ${value}?>`)
      }
      nodes.pop()
      continue
    }
    const element = node as PageElement
    const elementTagName = read<string>(element, 'Element', 'tagName')
    const attributes = read<PageElement['attributes']>(element, 'Element', 'attributes')
    add(`<${elementTagName}`)
    let attributeIndex = 0
    while (attributeIndex < attributes.length) {
      const attribute = attributes[attributeIndex]!
      attributeIndex += 1
      add(` ${attribute.name}="`)
      add(attribute.value, 'attribute')
      add('"')
      if (traversalWork >= maxTraversalWork) break
    }
    add('>')
    // Void, raw-text, body and template rules apply only to HTML-namespace elements; foreign
    // content such as <svg><source> serializes its children and end tag.
    const namespace = read<string | null | undefined>(element, 'Element', 'namespaceURI')
    const isHtml = namespace === undefined || namespace === 'http://www.w3.org/1999/xhtml'
    const tagName = isHtml ? elementTagName.toUpperCase() : ''
    if (tagName === 'BODY') body = element
    if (VOID_ELEMENTS.includes(tagName)) {
      nodes.pop()
      continue
    }
    const content =
      tagName === 'TEMPLATE'
        ? read<PageElement['content']>(element, 'HTMLTemplateElement', 'content')
        : undefined
    current.children = content?.childNodes ?? read<ArrayLike<PageNode>>(node, 'Node', 'childNodes')
    current.index = 0
    current.tagName = elementTagName
    current.rawTextParent = RAW_TEXT_PARENTS.includes(tagName)
  }
  if (traversalWork < maxTraversalWork) {
    const innerText = body ? read<string | undefined>(body, 'HTMLElement', 'innerText') : undefined
    contentLength = Math.min(maxContentLength, innerText?.length ?? 0)
  }
  if (omitHtml) return { contentLength, html: undefined, title: getBoundedTitle() }
  let html: string
  try {
    html = read<string>(root, 'Element', 'outerHTML')
  } catch {
    return { contentLength, html: undefined, title: getBoundedTitle() }
  }
  if (new TextEncoder().encode(html).byteLength > maxHtmlBytes) {
    return { contentLength, html: undefined, title: getBoundedTitle() }
  }
  return { contentLength, html, title: getBoundedTitle() }
}
