# @vouchington/frontmatter

Deterministic YAML frontmatter serialization. `toFrontmatter` drops nullish fields and empty arrays,
normalizes Dates to ISO timestamps, preserves semantic strings through YAML quoting, and emits
`---` delimiters.
