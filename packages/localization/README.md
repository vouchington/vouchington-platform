# @vouchington/localization

Browser-safe localization contracts for Node 24+ and browsers. The package owns locale
normalization (`en` aliases `en-US`), exact and terminal-prefix selector validation, ordered
fallback, and deterministic catalog-table serialization. It does not load catalogs, open SQLite,
or interpolate message text.

Catalog source separates reusable copy from where each consumer renders it:

- `copies.json`: `{ id, descriptor }` rows.
- `aliases.json`: `{ consumer, alias, copyId }` rows.
- `translations/<locale>.json`: `{ id, value }` rows.
- `routes.json` (generated): legacy `{ consumer, selectorId, alias }` rows remain accepted during
  migration. New rows use `{ consumer, pattern, alias? }`; a row without `alias` records a known
  empty selector. Runtime IDs are derived deterministically from each pattern's sorted aliases.

A route selector resolves its generated membership independently of alias spelling, then returns
the existing v1 alias-keyed wire response. Multiple aliases and consumers can therefore share one
copy and its full translation variants.

`@vouchington/localization-compiler` expands generated pattern rows into an immutable SQLite
artifact, persists known selector IDs separately from aliases, and resolves the same selectors
locally. Its CLI owns table updates, formatting, CSV interchange, and three-way merges so catalog
edits remain deterministic.
