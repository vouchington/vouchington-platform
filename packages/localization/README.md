# @vouchington/localization

Browser-safe localization contracts for Node 24+ and browsers. The package owns locale
normalization (`en` aliases `en-US`), exact and terminal-prefix selector validation, ordered
fallback, consumer membership, and deterministic catalog serialization. It does not load catalogs,
open SQLite, or interpolate message text.

`@vouchington/localization-compiler` compiles namespace-sharded JSON into an immutable SQLite
artifact and resolves the same selectors locally.
