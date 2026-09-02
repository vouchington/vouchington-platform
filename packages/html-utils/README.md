# @vouchington/html-utils

Small HTML text utilities backed only by `entities`: escaping, strict entity decoding with optional
caller-selected case-insensitive legacy names, and lightweight lexical checks for tags or selected
elements. `isInsideCode` is the `code`/`pre` convenience over `isInsideHtmlElement`. Named-entity
allowlists stay caller-owned. This package does not parse, sanitize, or render HTML.
