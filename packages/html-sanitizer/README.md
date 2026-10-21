# @vouchington/html-sanitizer

Parse an HTML fragment with `parse5` and serialize only the tags, attributes, and URL schemes
the caller allows. The default policy preserves today's prose fragment: common text, list, table,
and media tags; `class`, `title`, `aria-*`, `data-*`, and a few per-tag attributes; `http`,
`https`, `mailto`, and `tel` links; `http` and `https` images. `on*` and `style` are rejected.
Dangerous tags are dropped with their contents. A blank link target receives
`rel="noopener noreferrer"`.

```ts
import {
  sanitizeHtmlFragment,
  sanitizeHtmlFragmentDemotingHeadings,
  htmlFragmentToPlainText,
  isSafeUrl,
} from '@vouchington/html-sanitizer'

const html = sanitizeHtmlFragment('<p onclick="alert(1)">Hello</p>')
const preview = sanitizeHtmlFragmentDemotingHeadings('<h1>Title</h1>', { headingOffset: 2 })
```

`sanitizeHtmlFragmentDemotingHeadings` returns `null` or `undefined` unchanged, returns `''` for
an empty string, and clamps demoted headings at `h6`. The default offset is `2`.
`htmlFragmentToPlainText` decodes entities and collapses whitespace, including non-breaking
spaces. Pass `Partial` policy fields to override one list without replacing the others.
`isSafeUrl` strips whitespace, rejects scheme-relative URLs, and treats a colon after `/`, `?`,
or `#` as part of a relative URL.
