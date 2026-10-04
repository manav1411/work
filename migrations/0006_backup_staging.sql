-- Restore sessions stage bounded files before an atomic metadata commit.
CREATE TABLE backup_restore_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  manifest_hash TEXT NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  committed_at TEXT,
  response TEXT CHECK(response IS NULL OR json_valid(response)),
  UNIQUE(owner_id, manifest_hash)
);
CREATE INDEX backup_restore_expiry_idx ON backup_restore_sessions(owner_id, expires_at);
CREATE TABLE backup_restore_files (
  session_id TEXT NOT NULL REFERENCES backup_restore_sessions(id) ON DELETE CASCADE,
  original_id TEXT NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  checksum TEXT,
  uploaded_at TEXT,
  PRIMARY KEY(session_id, original_id)
);
