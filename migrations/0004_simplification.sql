-- Additive: legacy records, revisions, files and provider credentials remain intact.
CREATE TABLE goals (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE INDEX goals_owner_idx ON goals(owner_id, deleted_at, updated_at);
CREATE TABLE learning_source_cache (
  owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  fetched_at TEXT NOT NULL,
  PRIMARY KEY(owner_id, source_key)
);
