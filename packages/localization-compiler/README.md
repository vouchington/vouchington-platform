# @vouchington/localization-compiler

Node-only compiler for `@vouchington/localization`. It validates namespace-sharded JSON catalogs,
requires complete `en-US` with sparse partial locales, emits an immutable read-only SQLite
artifact, and exposes the same consumer/locale/selector resolver used by application CLIs.

Catalog shards must be a JSON array with one compact message per line (`id` first, sorted).
`compile` rejects any other layout. Line tools never parse the shard as a JSON document:

```bash
vouchington-localization upsert --file localization/catalog/common.json --message '{"id":"common.ok","consumers":["web"],"descriptor":null,"translations":{"en-US":"OK"}}'
vouchington-localization remove --file localization/catalog/common.json --id common.ok
vouchington-localization format --source localization/catalog
```

Git merge is 3-way by message id, then by field (configure once per clone). Adding `es` on one
branch and `fr` on the other auto-merges. Both sides changing the same locale, descriptor, or
deleting vs editing the same id is a conflict.

```gitattributes
localization/catalog/*.json merge=vouchington-localization
```

```gitconfig
[merge "vouchington-localization"]
  name = Merge localization catalog shards by message id and locale
  driver = vouchington-localization git-merge %O %A %B
```

CSV import/export is interchange only: never source of truth and never compiled directly to
SQLite. Native resource helpers emit strings, RESX, and typed key/descriptor files from the
same resolved catalog without product path assumptions.
