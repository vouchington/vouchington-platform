export const SQLITE_SCHEMA = `
PRAGMA encoding = 'UTF-8';
PRAGMA foreign_keys = ON;
CREATE TABLE metadata (
  key TEXT PRIMARY KEY NOT NULL CHECK (key IN ('contract', 'revision')),
  value TEXT NOT NULL
);
CREATE TABLE messages (
  id TEXT PRIMARY KEY NOT NULL,
  descriptor_json TEXT NOT NULL
);
CREATE TABLE translations (
  locale TEXT NOT NULL,
  message_id TEXT NOT NULL,
  value_json TEXT NOT NULL,
  PRIMARY KEY (locale, message_id),
  FOREIGN KEY (message_id) REFERENCES messages(id)
);
CREATE TABLE consumer_membership (
  consumer TEXT NOT NULL,
  message_id TEXT NOT NULL,
  PRIMARY KEY (consumer, message_id),
  FOREIGN KEY (message_id) REFERENCES messages(id)
);
CREATE TABLE editorial_tags (
  message_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (message_id, tag),
  FOREIGN KEY (message_id) REFERENCES messages(id)
);
CREATE INDEX translations_by_locale_id ON translations (locale, message_id);
CREATE INDEX membership_by_consumer_id ON consumer_membership (consumer, message_id);
CREATE INDEX messages_by_id ON messages (id);
`

export const DEFAULT_SQLITE_CACHE_KB = 2048
export const DEFAULT_TTL_SECONDS = 86_400
