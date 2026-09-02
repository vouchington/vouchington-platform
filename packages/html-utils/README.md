# @vouchington/html-utils

Small HTML text utilities backed only by `entities`: escaping, strict entity decoding with optional
caller-selected case-insensitive legacy names, and lightweight lexical checks for tags or selected
elements. `isInsideCode` is the `code`/`pre` convenience over `isInsideHtmlElement`.
`HTML_LEGACY_CASE_INSENSITIVE_NAMED_ENTITIES` is the shared catalog for case-insensitive named-entity
normalization; `decodeHtmlEntities` still defaults to no case-insensitive names. This package does
not parse, sanitize, or render HTML.
