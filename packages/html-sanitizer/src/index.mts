import { parseFragment } from 'parse5'
import {
  DEFAULT_HTML_SANITIZE_POLICY,
  HTML_FRAGMENT_VOID_TAGS,
  resolveHtmlSanitizePolicy,
  type HtmlSanitizePolicy,
} from './policy.mts'
import { demoteHeadingNodes, plainTextChildren, renderChildren } from './render.mts'
import { isSafeUrl } from './url.mts'

declare const SAFE_HTML_FRAGMENT: unique symbol

export type SafeHtmlFragment = string & { readonly [SAFE_HTML_FRAGMENT]: true }
export type { HtmlSanitizePolicy }
export { DEFAULT_HTML_SANITIZE_POLICY, HTML_FRAGMENT_VOID_TAGS, isSafeUrl }

export function sanitizeHtmlFragment(
  html: string,
  policy?: Partial<HtmlSanitizePolicy>,
): SafeHtmlFragment {
  return renderChildren(parseFragment(html), resolveHtmlSanitizePolicy(policy)) as SafeHtmlFragment
}

export function sanitizeHtmlFragmentDemotingHeadings(
  html: string | null | undefined,
  options?: { headingOffset?: number; policy?: Partial<HtmlSanitizePolicy> },
): SafeHtmlFragment | null | undefined {
  if (html === null || html === undefined) return html
  if (!html) return '' as SafeHtmlFragment

  const fragment = parseFragment(html)
  demoteHeadingNodes(fragment, options?.headingOffset ?? 2)
  return renderChildren(fragment, resolveHtmlSanitizePolicy(options?.policy)) as SafeHtmlFragment
}

export function htmlFragmentToPlainText(
  html: string,
  options?: { dangerousTags?: ReadonlySet<string> },
): string {
  const dangerousTags = options?.dangerousTags ?? DEFAULT_HTML_SANITIZE_POLICY.dangerousTags
  return plainTextChildren(parseFragment(html), dangerousTags)
    .replace(/[\s\u00A0]+/g, ' ')
    .trim()
}
