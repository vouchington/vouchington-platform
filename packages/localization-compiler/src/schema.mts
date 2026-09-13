export const SQLITE_SCHEMA = `
PRAGMA encoding = 'UTF-8';
PRAGMA foreign_keys = ON;
CREATE TABLE metadata (
  key TEXT PRIMARY KEY NOT NULL CHECK (key IN ('contract', 'revision')),
  value TEXT NOT NULL
);
CREATE TABLE copies (
  id TEXT PRIMARY KEY NOT NULL,
  descriptor_json TEXT NOT NULL
);
CREATE TABLE translations (
  locale TEXT NOT NULL,
  copy_id TEXT NOT NULL,
  value_json TEXT NOT NULL,
  PRIMARY KEY (locale, copy_id),
  FOREIGN KEY (copy_id) REFERENCES copies(id)
);
CREATE TABLE consumer_aliases (
  consumer TEXT NOT NULL,
  alias TEXT NOT NULL,
  copy_id TEXT NOT NULL,
  PRIMARY KEY (consumer, alias),
  FOREIGN KEY (copy_id) REFERENCES copies(id)
);
CREATE TABLE route_membership (
  consumer TEXT NOT NULL,
  selector_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  PRIMARY KEY (consumer, selector_id, alias),
  FOREIGN KEY (consumer, alias) REFERENCES consumer_aliases(consumer, alias)
);
CREATE TABLE editorial_tags (
  copy_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (copy_id, tag),
  FOREIGN KEY (copy_id) REFERENCES copies(id)
);
CREATE INDEX translations_by_locale_id ON translations (locale, copy_id);
CREATE INDEX aliases_by_consumer_alias ON consumer_aliases (consumer, alias);
CREATE INDEX routes_by_consumer_selector ON route_membership (consumer, selector_id);
`

export const DEFAULT_SQLITE_CACHE_KB = 2048
export const DEFAULT_TTL_SECONDS = 86_400
