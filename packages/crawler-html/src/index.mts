import { Buffer } from 'node:buffer'
import { MIMEType } from 'node:util'
import {
  decodeHtml,
  getContentFromHtml,
  type CrawlerHtmlToMarkdownOptions,
  type CrawlerHtmlToMarkdownResult,
} from '@jongleberry/vurst-html'

const HTML_CONTENT_TYPES = ['text/html', 'application/xhtml+xml']

export type { CrawlerHtmlToMarkdownOptions, CrawlerHtmlToMarkdownResult }

/** Returns whether an HTTP content type is an HTML representation. */
export function isHtmlContentType(contentType: string | null | undefined): boolean {
  if (!contentType) return false
  try {
    return HTML_CONTENT_TYPES.includes(new MIMEType(contentType).essence)
  } catch {
    return false
  }
}

/** Decodes raw response bytes and extracts the content using Vurst's HTML parser. */
export async function extractHtmlContent(
  body: Uint8Array,
  contentType: string,
  options: CrawlerHtmlToMarkdownOptions,
): Promise<CrawlerHtmlToMarkdownResult> {
  if (!isHtmlContentType(contentType)) {
    throw new TypeError(`Expected an HTML content type, received ${contentType}`)
  }
  const decoded = await decodeHtml(Buffer.from(body), contentType)
  return await getContentFromHtml(Buffer.from(decoded, 'utf8'), options)
}
