CREATE TABLE connector_connections (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK(provider IN ('notion','github','leetcode','overleaf')),
  account_id TEXT NOT NULL, label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'setting_up' CHECK(status IN ('setting_up','updating','connected','attention','paused','linked','disconnected')),
  config TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(config)),
  snapshot TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(snapshot)),
  credential TEXT,
  generation INTEGER NOT NULL DEFAULT 1,
  cursor TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(cursor)),
  created_at TEXT NOT NULL, last_success_at TEXT, last_attempt_at TEXT, next_sync_at TEXT, error TEXT,
  lease_token TEXT, lease_until TEXT,
  UNIQUE(owner_id,provider), UNIQUE(id,owner_id)
);
CREATE INDEX connector_due_idx ON connector_connections(status,next_sync_at);

CREATE TABLE connector_sources (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL,
  provider TEXT NOT NULL, account_id TEXT NOT NULL, source_id TEXT NOT NULL,
  record_id TEXT, source_url TEXT NOT NULL, snapshot TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(snapshot)),
  content_hash TEXT NOT NULL DEFAULT '',
  media TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(media)),
  selected INTEGER NOT NULL DEFAULT 1, available INTEGER NOT NULL DEFAULT 1,
  last_fetched_at TEXT NOT NULL, source_updated_at TEXT,
  UNIQUE(owner_id,provider,account_id,source_id),
  FOREIGN KEY(connection_id,owner_id) REFERENCES connector_connections(id,owner_id) ON DELETE CASCADE,
  FOREIGN KEY(record_id) REFERENCES records(id) ON DELETE SET NULL
);
CREATE INDEX connector_source_record_idx ON connector_sources(owner_id,record_id);

CREATE TABLE connector_activity (
  id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL, provider TEXT NOT NULL, source_key TEXT NOT NULL,
  title TEXT NOT NULL, url TEXT NOT NULL, occurred_at TEXT NOT NULL, problem_slug TEXT, record_id TEXT,
  action_id TEXT, dismissed INTEGER NOT NULL DEFAULT 0,
  UNIQUE(owner_id,provider,source_key),
  FOREIGN KEY(connection_id,owner_id) REFERENCES connector_connections(id,owner_id) ON DELETE CASCADE
);
CREATE INDEX connector_activity_owner_idx ON connector_activity(owner_id,occurred_at DESC,id);

CREATE TABLE connector_runs (
  id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running','success','failed')),
  message TEXT NOT NULL DEFAULT '', changed INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL, finished_at TEXT,
  FOREIGN KEY(connection_id,owner_id) REFERENCES connector_connections(id,owner_id) ON DELETE CASCADE
);
CREATE INDEX connector_runs_owner_idx ON connector_runs(owner_id,connection_id,started_at DESC);

CREATE TABLE connector_oauth_states (
  state_hash TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK(provider IN ('notion','github')),
  session_hash TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE connector_webhook_subscriptions (
  id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL, credential TEXT, expires_at TEXT NOT NULL, created_at TEXT NOT NULL,
  FOREIGN KEY(connection_id,owner_id) REFERENCES connector_connections(id,owner_id) ON DELETE CASCADE
);
CREATE TABLE connector_deliveries (
  provider TEXT NOT NULL, delivery_id TEXT NOT NULL, received_at TEXT NOT NULL, processed_at TEXT,
  PRIMARY KEY(provider,delivery_id)
);
