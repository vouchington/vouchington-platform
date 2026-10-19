export interface HtmlSanitizePolicy {
  allowedTags: ReadonlySet<string>
  dangerousTags: ReadonlySet<string>
  isAllowedAttribute: (tag: string, name: string) => boolean
  linkSchemes: ReadonlySet<string>
  imageSchemes: ReadonlySet<string>
}

const ALLOWED_TAGS = new Set(
  'p br a strong em b i u s del h1 h2 h3 h4 h5 h6 ul ol li blockquote pre code table thead tbody tr th td img hr figure figcaption details summary sup sub span div dl dt dd'.split(
    ' ',
  ),
)

const DANGEROUS_TAGS = new Set(
  'script style iframe object embed form input button select textarea meta base svg math template'.split(
    ' ',
  ),
)

export const HTML_FRAGMENT_VOID_TAGS: ReadonlySet<string> = new Set(['br', 'hr', 'img'])

function isDefaultAllowedAttribute(tagName: string, name: string): boolean {
  if (name === 'style' || /^on/i.test(name)) return false
  if (name === 'class' || name === 'title') return true
  if (name.startsWith('aria-') || name.startsWith('data-')) return true
  if (tagName === 'a') return name === 'href' || name === 'rel' || name === 'target'
  if (tagName === 'details') return name === 'open'
  if (tagName === 'td' || tagName === 'th') return name === 'colspan' || name === 'rowspan'
  return (
    tagName === 'img' &&
    (name === 'src' ||
      name === 'alt' ||
      name === 'width' ||
      name === 'height' ||
      name === 'loading' ||
      name === 'decoding' ||
      name === 'fetchpriority')
  )
}

export const DEFAULT_HTML_SANITIZE_POLICY: HtmlSanitizePolicy = {
  allowedTags: ALLOWED_TAGS,
  dangerousTags: DANGEROUS_TAGS,
  isAllowedAttribute: isDefaultAllowedAttribute,
  linkSchemes: new Set(['http', 'https', 'mailto', 'tel']),
  imageSchemes: new Set(['http', 'https']),
}

export function resolveHtmlSanitizePolicy(
  policy?: Partial<HtmlSanitizePolicy>,
): HtmlSanitizePolicy {
  return {
    allowedTags: policy?.allowedTags ?? DEFAULT_HTML_SANITIZE_POLICY.allowedTags,
    dangerousTags: policy?.dangerousTags ?? DEFAULT_HTML_SANITIZE_POLICY.dangerousTags,
    isAllowedAttribute:
      policy?.isAllowedAttribute ?? DEFAULT_HTML_SANITIZE_POLICY.isAllowedAttribute,
    linkSchemes: policy?.linkSchemes ?? DEFAULT_HTML_SANITIZE_POLICY.linkSchemes,
    imageSchemes: policy?.imageSchemes ?? DEFAULT_HTML_SANITIZE_POLICY.imageSchemes,
  }
}
