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
  const getBoundedTitle = (): string => {
    const title = (globalThis as unknown as { document?: { title?: string } }).document?.title ?? ''
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
  // outerHTML writes these elements' text unescaped (the HTML fragment serialization algorithm).
  const RAW_TEXT_PARENTS = [
    'IFRAME',
    'NOEMBED',
    'NOFRAMES',
    'NOSCRIPT',
    'PLAINTEXT',
    'SCRIPT',
    'STYLE',
    'XMP',
  ]
  const doc = (globalThis as unknown as { document?: PageDocument }).document
  const root = doc?.documentElement
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
      if (escape === 'text' && (char === '&' || char === '<' || char === '>')) serializedBytes += 5
      else if (escape === 'attribute' && (char === '&' || char === '"' || char === '<'))
        serializedBytes += 6
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
    rawText?: boolean
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
        const rawText = RAW_TEXT_PARENTS.includes(current.tagName!.toUpperCase())
        nodes.push({ node: current.children[index]!, rawText })
        continue
      }
      add(`</${current.tagName}>`)
      nodes.pop()
      continue
    }
    if (node.nodeType === TEXT_NODE) {
      add(node.nodeValue ?? '', current.rawText ? 'none' : 'text')
      nodes.pop()
      continue
    }
    if (node.nodeType === COMMENT_NODE) {
      add(`<!--${node.nodeValue ?? ''}-->`)
      nodes.pop()
      continue
    }
    if (node.nodeType !== ELEMENT_NODE) {
      nodes.pop()
      continue
    }
    const element = node as PageElement
    add(`<${element.tagName}`)
    let attributeIndex = 0
    while (attributeIndex < element.attributes.length) {
      const attribute = element.attributes[attributeIndex]!
      attributeIndex += 1
      add(` ${attribute.name}="`)
      add(attribute.value, 'attribute')
      add('"')
      if (traversalWork >= maxTraversalWork) break
    }
    add('>')
    const tagName = element.tagName.toUpperCase()
    if (tagName === 'BODY') body = element
    const children = element.content?.childNodes ?? element.childNodes
    current.children = children
    current.index = 0
    current.tagName = element.tagName
  }
  if (traversalWork < maxTraversalWork) {
    contentLength = Math.min(maxContentLength, body?.innerText?.length ?? 0)
  }
  if (omitHtml) return { contentLength, html: undefined, title: getBoundedTitle() }
  let html: string
  try {
    html = root.outerHTML
  } catch {
    return { contentLength, html: undefined, title: getBoundedTitle() }
  }
  if (new TextEncoder().encode(html).byteLength > maxHtmlBytes) {
    return { contentLength, html: undefined, title: getBoundedTitle() }
  }
  return { contentLength, html, title: getBoundedTitle() }
}
