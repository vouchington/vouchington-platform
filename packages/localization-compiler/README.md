# @vouchington/localization-compiler

Node-only compiler for `@vouchington/localization`. It validates row-based JSON catalogs, requires
complete `en-US` with sparse partial locales, emits an immutable read-only SQLite artifact, and
exposes the same consumer/locale/selector resolver used by application CLIs.

Catalog source has three canonical tables: `copies.json` (`{ id, descriptor }`), `aliases.json`
(`{ consumer, alias, copyId }`), and `translations/<locale>.json` (`{ id, value }`). A generated
`routes.json` accepts legacy `{ consumer, selectorId, alias }` rows while generated source moves
to `{ consumer, pattern, alias? }` rows. A presence-only pattern row records a known empty route;
the compiler derives stable per-selector IDs from its sorted aliases, expands alias membership,
and persists the complete exact-selector registry. An unknown exact selector therefore produces
an empty v1 message batch, while a known empty selector can still resolve requested chrome.
Full plural and select-plural translation values remain values in the locale table.

```bash
vouchington-localization upsert --file localization/catalog/copies.json --row '{"id":"copy.ok","descriptor":null}'
vouchington-localization upsert --file localization/catalog/aliases.json --row '{"consumer":"web","alias":"web.common.ok","copyId":"copy.ok"}'
vouchington-localization upsert --file localization/catalog/translations/en-US.json --row '{"id":"copy.ok","value":"OK"}'
vouchington-localization remove --file localization/catalog/aliases.json --id web.common.ok --consumer web
vouchington-localization format --source localization/catalog
vouchington-localization format --check --source localization/catalog
```

`remove` throws the exported `CatalogRowNotFoundError` (a `TypeError` with
`code: 'ERR_CATALOG_ROW_NOT_FOUND'`, `id`, and `consumer`) when no row matches. Callers that want
idempotent removes should catch it by class or `code`, never by message text.

`format --check` reads the same managed catalog tables as `format`, validates the complete
catalog, and exits nonzero when a table needs canonicalization or violates catalog semantics. It
never writes source files, so use it in CI; use `format` to rewrite rows. `tags.json` remains
outside formatter ownership.

Git merge is 3-way by message id, then by field (configure once per clone). Adding `es` on one
branch and `fr` on the other auto-merges when both sides keep a compile-valid shape. An empty
`%O` (add/add of a new shard) is treated as `[]`. Both sides changing the same locale,
descriptor, or deleting vs editing the same id is a conflict.

```gitattributes
localization/catalog/*.json merge=vouchington-localization text eol=lf
localization/catalog/tags.json merge=text
```

```gitconfig
[merge "vouchington-localization"]
  name = Merge localization catalog shards by message id and locale
  driver = vouchington-localization git-merge %O %A %B --path %P
```

On conflict the driver retains every automatically merged row plus conflict markers for only the
conflicting rows, then exits non-zero. Resolve each row without editing JSON directly:

```bash
vouchington-localization conflict-resolve --file localization/catalog/copies.json --id copy.save --take ours
vouchington-localization conflict-resolve --file localization/catalog/aliases.json --id web.nav.save --consumer web --take theirs
vouchington-localization conflict-resolve --file localization/catalog/routes.json --id web.nav.save --consumer web --selector-id web.route.home --take ours
```

The command leaves any other row conflicts in place. After the final resolution it writes a
canonical table, ready to stage. A conflicted table must not be compiled.

CSV import/export is interchange only: never source of truth and never compiled directly to
SQLite. It covers only the three authoring tables (copies, aliases, translations); generated
route membership/selectors and editorial tags are excluded, so regenerate them from
routes.json and tags.json instead of round-tripping them through CSV. Native resource helpers emit strings, RESX, and typed key/descriptor files from the
same resolved catalog without product path assumptions.
