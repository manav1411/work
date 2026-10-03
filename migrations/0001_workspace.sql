PRAGMA foreign_keys = ON;

CREATE TABLE user (
  id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  email_verified INTEGER NOT NULL DEFAULT 0, image TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  github_id TEXT NOT NULL DEFAULT '', github_login TEXT NOT NULL DEFAULT ''
);
CREATE TABLE session (
  id TEXT PRIMARY KEY NOT NULL, expires_at INTEGER NOT NULL, token TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, ip_address TEXT, user_agent TEXT,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
);
CREATE INDEX session_user_idx ON session(user_id);
CREATE TABLE account (
  id TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, provider_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  access_token TEXT, refresh_token TEXT, id_token TEXT,
  access_token_expires_at INTEGER, refresh_token_expires_at INTEGER, scope TEXT, password TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX account_user_idx ON account(user_id);
CREATE UNIQUE INDEX account_identity_idx ON account(provider_id, account_id);
CREATE TABLE verification (
  id TEXT PRIMARY KEY NOT NULL, identifier TEXT NOT NULL, value TEXT NOT NULL,
  expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX verification_identifier_idx ON verification(identifier);

CREATE TABLE records (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('action','note','company','application','contact','interview','story','practice','topic','progress','achievement','project','asset','path','decision','review','focus','resource','rotation')),
  title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(tags)),
  links TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(links)),
  data TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(data)),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
  UNIQUE(id, owner_id)
);
CREATE INDEX records_owner_updated_idx ON records(owner_id, deleted_at, updated_at DESC);
CREATE INDEX records_owner_kind_idx ON records(owner_id, kind, deleted_at);

CREATE TABLE record_links (
  owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL, target_id TEXT NOT NULL,
  PRIMARY KEY(owner_id, source_id, target_id),
  FOREIGN KEY(source_id, owner_id) REFERENCES records(id, owner_id) ON DELETE CASCADE,
  FOREIGN KEY(target_id, owner_id) REFERENCES records(id, owner_id) ON DELETE CASCADE
);
CREATE INDEX record_links_target_idx ON record_links(owner_id, target_id);

CREATE TABLE record_revisions (
  id TEXT PRIMARY KEY NOT NULL, record_id TEXT NOT NULL,
  owner_id TEXT NOT NULL, version INTEGER NOT NULL,
  title TEXT NOT NULL, body TEXT NOT NULL, tags TEXT NOT NULL, links TEXT NOT NULL, data TEXT NOT NULL,
  created_at TEXT NOT NULL, deleted_at TEXT,
  FOREIGN KEY(record_id, owner_id) REFERENCES records(id, owner_id) ON DELETE CASCADE,
  UNIQUE(record_id, version)
);
CREATE INDEX revisions_owner_idx ON record_revisions(owner_id, record_id, version DESC);

CREATE VIRTUAL TABLE records_fts USING fts5(id UNINDEXED, owner_id UNINDEXED, title, body, tags, data, tokenize='unicode61 remove_diacritics 2');
CREATE TRIGGER records_insert AFTER INSERT ON records BEGIN
  INSERT INTO records_fts(id, owner_id, title, body, tags, data)
    SELECT NEW.id, NEW.owner_id, NEW.title, NEW.body, NEW.tags, NEW.data WHERE NEW.deleted_at IS NULL;
  INSERT INTO record_revisions(id, record_id, owner_id, version, title, body, tags, links, data, created_at, deleted_at)
    VALUES(NEW.id || ':' || NEW.version, NEW.id, NEW.owner_id, NEW.version, NEW.title, NEW.body, NEW.tags, NEW.links, NEW.data, NEW.updated_at, NEW.deleted_at);
END;
CREATE TRIGGER records_update AFTER UPDATE ON records BEGIN
  DELETE FROM records_fts WHERE id = OLD.id;
  INSERT INTO records_fts(id, owner_id, title, body, tags, data)
    SELECT NEW.id, NEW.owner_id, NEW.title, NEW.body, NEW.tags, NEW.data WHERE NEW.deleted_at IS NULL;
  INSERT INTO record_revisions(id, record_id, owner_id, version, title, body, tags, links, data, created_at, deleted_at)
    VALUES(NEW.id || ':' || NEW.version, NEW.id, NEW.owner_id, NEW.version, NEW.title, NEW.body, NEW.tags, NEW.links, NEW.data, NEW.updated_at, NEW.deleted_at);
END;
CREATE TRIGGER records_delete AFTER DELETE ON records BEGIN
  DELETE FROM records_fts WHERE id = OLD.id;
END;

CREATE TABLE preferences (
  owner_id TEXT PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  data TEXT NOT NULL CHECK(json_valid(data)), updated_at TEXT NOT NULL
);
CREATE TABLE attachments (
  id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, record_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE, filename TEXT NOT NULL, content_type TEXT NOT NULL,
  size INTEGER NOT NULL, created_at TEXT NOT NULL,
  FOREIGN KEY(record_id, owner_id) REFERENCES records(id, owner_id) ON DELETE CASCADE
);
CREATE INDEX attachments_owner_record_idx ON attachments(owner_id, record_id);

CREATE TABLE idempotency (
  owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  key TEXT NOT NULL, hash TEXT NOT NULL, response TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY(owner_id, key)
);
CREATE TABLE import_batches (
  id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  source TEXT NOT NULL, created_at TEXT NOT NULL, undone_at TEXT,
  created_count INTEGER NOT NULL DEFAULT 0, updated_count INTEGER NOT NULL DEFAULT 0, skipped_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX import_batches_owner_idx ON import_batches(owner_id, created_at DESC);
CREATE TABLE import_sources (
  owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  source TEXT NOT NULL, source_id TEXT NOT NULL, hash TEXT NOT NULL,
  record_id TEXT NOT NULL, batch_id TEXT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  PRIMARY KEY(owner_id, source, source_id),
  FOREIGN KEY(record_id, owner_id) REFERENCES records(id, owner_id) ON DELETE CASCADE
);
CREATE TABLE import_changes (
  batch_id TEXT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  record_id TEXT NOT NULL, before_record TEXT, before_source TEXT,
  after_version INTEGER NOT NULL, attachments TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY(batch_id, record_id)
);
-- Checking affected-row counts inside a D1 batch makes optimistic writes atomic.
CREATE TABLE write_guards (id TEXT PRIMARY KEY NOT NULL, value INTEGER NOT NULL CHECK(value = 1));
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY NOT NULL, window INTEGER NOT NULL, count INTEGER NOT NULL
);
