# @vouchington/localization

Browser-safe localization contracts for Node 24+ and browsers. The package owns locale
normalization (`en` aliases `en-US`), exact and terminal-prefix selector validation, ordered
fallback, consumer membership, and deterministic catalog serialization. It does not load catalogs,
open SQLite, or interpolate message text.

Catalog shards on disk are a JSON array with **one compact message object per line**. `id` is the
first key so git and line editors can add, remove, or update a message without parsing the file.
`parseCatalogShardText` rejects pretty-printed JSON, `{ messages }` wrappers, and unsorted ids.

`@vouchington/localization-compiler` compiles those shards into an immutable SQLite artifact,
resolves the same selectors locally, and ships `upsert` / `remove` / `git-merge` for the line
format. `git-merge` is 3-way: union independent ids, then merge consumers, descriptor, and
each locale. Same-locale edits conflict and write `<<<<<<< ours` markers; adding `es` on one
side and `fr` on the other does not.
