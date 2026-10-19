import type { DefaultTreeAdapterMap } from 'parse5'
import type { HtmlSanitizePolicy } from './policy.mts'
import { isSafeUrl } from './url.mts'

type HtmlAttribute = DefaultTreeAdapterMap['element']['attrs'][number]

export function renderAttributes(
  tagName: string,
  attrs: readonly HtmlAttribute[],
  policy: HtmlSanitizePolicy,
): string {
  const allowed: HtmlAttribute[] = []
  for (const attr of attrs) {
    const name = attr.name.toLowerCase()
    if (!policy.isAllowedAttribute(tagName, name)) continue
    if (name === 'href' && !isSafeUrl(attr.value, policy.linkSchemes)) continue
    if (name === 'src' && !isSafeUrl(attr.value, policy.imageSchemes)) continue
    allowed.push({ name, value: attr.value })
  }

  enforceBlankTargetRel(tagName, allowed)
  if (allowed.length === 0) return ''
  const rendered = allowed.map((attr) => `${attr.name}="${escapeAttributeValue(attr.value)}"`)
  return ` ${rendered.join(' ')}`
}

function enforceBlankTargetRel(tagName: string, attrs: HtmlAttribute[]): void {
  if (tagName !== 'a') return
  const target = attrs.find((attr) => attr.name === 'target')
  if (!target || target.value.trim().toLowerCase() !== '_blank') return

  const rel = attrs.find((attr) => attr.name === 'rel')
  const tokens = new Set(rel?.value.toLowerCase().split(/\s+/).filter(Boolean) ?? [])
  tokens.add('noopener')
  tokens.add('noreferrer')
  const value = [...tokens].join(' ')
  if (rel) rel.value = value
  else attrs.push({ name: 'rel', value })
}

function escapeAttributeValue(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
}
