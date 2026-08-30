import { MIMEType } from 'node:util'
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'

import { resolveHttpUrl } from './metadata.mts'

export interface OEmbedMetadata {
  type: string | null
  title: string | null
  authorName: string | null
  authorUrl: URL | null
  providerName: string | null
  providerUrl: URL | null
  thumbnailUrl: URL | null
  thumbnailWidth: number | null
  thumbnailHeight: number | null
  playerUrl: URL | null
  width: number | null
  height: number | null
}

export function parseOEmbedResponse(
  body: Uint8Array,
  contentType: string,
  base: URL,
): OEmbedMetadata {
  assertJsonContentType(contentType)
  const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body))
  if (!isRecord(value)) throw new TypeError('oEmbed response must be a JSON object')
  return {
    type: stringValue(value.type),
    title: stringValue(value.title),
    authorName: stringValue(value.author_name),
    authorUrl: resolveHttpUrl(stringValue(value.author_url), base),
    providerName: stringValue(value.provider_name),
    providerUrl: resolveHttpUrl(stringValue(value.provider_url), base),
    thumbnailUrl: resolveHttpUrl(stringValue(value.thumbnail_url), base),
    thumbnailWidth: dimension(value.thumbnail_width),
    thumbnailHeight: dimension(value.thumbnail_height),
    playerUrl: iframeUrl(stringValue(value.html), base),
    width: dimension(value.width),
    height: dimension(value.height),
  }
}

function assertJsonContentType(contentType: string): void {
  let essence: string
  try {
    essence = new MIMEType(contentType).essence
  } catch {
    throw new TypeError('oEmbed response has an invalid Content-Type')
  }
  if (essence !== 'application/json' && !essence.endsWith('+json')) {
    throw new TypeError(`Expected a JSON oEmbed response, received ${contentType}`)
  }
}

function iframeUrl(html: string | null, base: URL): URL | null {
  if (!html) return null
  const fragment = parseFragment(html)
  const iframes: DefaultTreeAdapterMap['element'][] = []
  visit(fragment, iframes)
  if (iframes.length !== 1) return null
  const src = iframes[0]?.attrs.find((attribute) => attribute.name === 'src')?.value ?? null
  return resolveHttpUrl(src, base)
}

function visit(
  node: DefaultTreeAdapterMap['node'],
  iframes: DefaultTreeAdapterMap['element'][],
): void {
  if ('tagName' in node && node.tagName === 'iframe') iframes.push(node)
  if ('childNodes' in node) for (const child of node.childNodes) visit(child, iframes)
}

function stringValue(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function dimension(value: unknown): number | null {
  const number = typeof value === 'string' && value.trim() ? Number(value) : value
  return typeof number === 'number' && Number.isSafeInteger(number) && number > 0 ? number : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
