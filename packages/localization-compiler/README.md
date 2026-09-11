# @vouchington/localization-compiler

Node-only compiler for `@vouchington/localization`. It validates namespace-sharded JSON catalogs,
requires complete `en-US` with sparse partial locales, emits an immutable read-only SQLite
artifact, and exposes the same consumer/locale/selector resolver used by application CLIs.

CSV import/export is interchange only: never source of truth and never compiled directly to
SQLite. Native resource helpers emit strings, RESX, and typed key/descriptor files from the
same resolved catalog without product path assumptions.
