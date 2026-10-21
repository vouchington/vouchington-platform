import type { DefaultTreeAdapterMap } from 'parse5'
import { renderAttributes } from './attributes.mts'
import { HTML_FRAGMENT_VOID_TAGS, type HtmlSanitizePolicy } from './policy.mts'

type HtmlChildNode = DefaultTreeAdapterMap['childNode']
type HtmlParentNode = DefaultTreeAdapterMap['parentNode']

export function renderChildren(node: HtmlParentNode, policy: HtmlSanitizePolicy): string {
  return node.childNodes.map((child) => renderNode(child, policy)).join('')
}

export function plainTextChildren(
  node: HtmlParentNode,
  dangerousTags: ReadonlySet<string>,
): string {
  return node.childNodes.map((child) => plainTextNode(child, dangerousTags)).join('')
}

export function demoteHeadingNodes(node: HtmlParentNode, headingOffset: number): void {
  for (const child of node.childNodes) {
    if ('tagName' in child && isHeadingTagName(child.tagName)) {
      const nextLevel = Math.min(Number(child.tagName.slice(1)) + headingOffset, 6)
      child.tagName = `h${nextLevel}`
      child.nodeName = child.tagName
    }
    if ('childNodes' in child) demoteHeadingNodes(child, headingOffset)
  }
}

function renderNode(node: HtmlChildNode, policy: HtmlSanitizePolicy): string {
  if ('value' in node) return escapeText(node.value)
  if (!('tagName' in node)) return ''

  const tagName = node.tagName.toLowerCase()
  if (policy.dangerousTags.has(tagName)) return ''

  const children = renderChildren(node, policy)
  if (!policy.allowedTags.has(tagName)) return children

  const attrs = renderAttributes(tagName, node.attrs, policy)
  const open = `<${tagName}${attrs}>`
  if (HTML_FRAGMENT_VOID_TAGS.has(tagName)) return open
  return `${open}${children}</${tagName}>`
}

function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function plainTextNode(node: HtmlChildNode, dangerousTags: ReadonlySet<string>): string {
  if ('value' in node) return node.value
  if (!('tagName' in node)) return ''

  const tagName = node.tagName.toLowerCase()
  if (dangerousTags.has(tagName)) return ''
  if (HTML_FRAGMENT_VOID_TAGS.has(tagName)) return ' '
  return ` ${plainTextChildren(node, dangerousTags)} `
}

function isHeadingTagName(tagName: string): boolean {
  const level = Number(tagName.slice(1))
  return tagName.length === 2 && tagName.startsWith('h') && level >= 1 && level <= 6
}
