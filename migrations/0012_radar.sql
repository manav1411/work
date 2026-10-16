CREATE TABLE radar_settings (
 owner_id TEXT PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 payload TEXT NOT NULL CHECK(json_valid(payload)), version INTEGER NOT NULL DEFAULT 1,
 next_run_at TEXT, next_email_at TEXT, email_since TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE radar_opportunities (
 id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 payload TEXT NOT NULL CHECK(json_valid(payload)), version INTEGER NOT NULL DEFAULT 1,
 first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
 saved INTEGER NOT NULL DEFAULT 0, flagged INTEGER NOT NULL DEFAULT 0,
 dismissed INTEGER NOT NULL DEFAULT 0, seen INTEGER NOT NULL DEFAULT 0,
 tracked INTEGER NOT NULL DEFAULT 0, notified INTEGER NOT NULL DEFAULT 0,
 notes TEXT NOT NULL DEFAULT '', assessment TEXT CHECK(assessment IS NULL OR json_valid(assessment)),
 profile_ids TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(profile_ids)), interest REAL NOT NULL DEFAULT -1,
 UNIQUE(id,owner_id)
);
CREATE INDEX radar_visibility_idx ON radar_opportunities(owner_id,saved,dismissed,tracked,interest DESC,id);
CREATE TABLE radar_identities (
 owner_id TEXT NOT NULL, identity TEXT NOT NULL, opportunity_id TEXT NOT NULL,
 PRIMARY KEY(owner_id,identity), FOREIGN KEY(opportunity_id,owner_id) REFERENCES radar_opportunities(id,owner_id) ON DELETE CASCADE
);
CREATE TABLE radar_application_links (
 owner_id TEXT NOT NULL, opportunity_id TEXT NOT NULL, application_id TEXT NOT NULL,
 PRIMARY KEY(owner_id,opportunity_id), UNIQUE(owner_id,application_id),
 FOREIGN KEY(opportunity_id,owner_id) REFERENCES radar_opportunities(id,owner_id) ON DELETE CASCADE,
 FOREIGN KEY(application_id,owner_id) REFERENCES records(id,owner_id) ON DELETE CASCADE
);
CREATE TRIGGER radar_application_track AFTER INSERT ON radar_application_links BEGIN
 UPDATE radar_opportunities SET tracked=1,version=version+1 WHERE id=NEW.opportunity_id AND owner_id=NEW.owner_id;
END;
CREATE TABLE radar_scores (
 owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, cache_key TEXT NOT NULL,
 payload TEXT NOT NULL CHECK(json_valid(payload)), PRIMARY KEY(owner_id,cache_key)
);
CREATE TABLE radar_runs (
 id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 epoch TEXT NOT NULL, config_version INTEGER NOT NULL, manual INTEGER NOT NULL,
 status TEXT NOT NULL, created_at TEXT NOT NULL, finished_at TEXT,
 found INTEGER NOT NULL DEFAULT 0, scored INTEGER NOT NULL DEFAULT 0, messages TEXT NOT NULL DEFAULT '[]'
);
CREATE UNIQUE INDEX radar_active_run_idx ON radar_runs(owner_id) WHERE status IN ('queued','running');
CREATE TABLE radar_tasks (
 id TEXT PRIMARY KEY NOT NULL, run_id TEXT NOT NULL REFERENCES radar_runs(id) ON DELETE CASCADE,
 owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 kind TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)),
 status TEXT NOT NULL DEFAULT 'queued', lease_until INTEGER NOT NULL DEFAULT 0,
 attempts INTEGER NOT NULL DEFAULT 0, UNIQUE(run_id,kind,payload)
);
CREATE INDEX radar_tasks_due_idx ON radar_tasks(status,lease_until);
CREATE TABLE radar_usage (
 provider TEXT NOT NULL, scope TEXT NOT NULL, period TEXT NOT NULL, units REAL NOT NULL DEFAULT 0,
 PRIMARY KEY(provider,scope,period)
);
CREATE TABLE radar_cursors (
 owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, source_id TEXT NOT NULL,
 profile_id TEXT NOT NULL, location TEXT NOT NULL, query_hash TEXT NOT NULL,
 cursor TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(owner_id,source_id,profile_id,location)
);
CREATE TABLE radar_deliveries (
 id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 epoch TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
 config_version INTEGER NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0,
 next_attempt_at INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX radar_active_delivery_idx ON radar_deliveries(owner_id) WHERE status IN ('queued','sending','uncertain');
CREATE TABLE radar_delivery_items (
 delivery_id TEXT NOT NULL REFERENCES radar_deliveries(id) ON DELETE CASCADE,
 owner_id TEXT NOT NULL, opportunity_id TEXT NOT NULL,
 PRIMARY KEY(owner_id,opportunity_id),
 FOREIGN KEY(opportunity_id,owner_id) REFERENCES radar_opportunities(id,owner_id) ON DELETE CASCADE
);
CREATE TRIGGER radar_settings_generation_insert AFTER INSERT ON radar_settings BEGIN
 UPDATE workspace_state SET generation=generation+1 WHERE owner_id=NEW.owner_id;
END;
CREATE TRIGGER radar_settings_generation_update AFTER UPDATE ON radar_settings BEGIN
 UPDATE workspace_state SET generation=generation+1 WHERE owner_id=NEW.owner_id;
END;
CREATE TRIGGER radar_settings_generation_delete AFTER DELETE ON radar_settings BEGIN
 UPDATE workspace_state SET generation=generation+1 WHERE owner_id=OLD.owner_id;
END;
CREATE TRIGGER radar_jobs_generation_insert AFTER INSERT ON radar_opportunities BEGIN
 UPDATE workspace_state SET generation=generation+1 WHERE owner_id=NEW.owner_id;
END;
CREATE TRIGGER radar_jobs_generation_update AFTER UPDATE ON radar_opportunities BEGIN
 UPDATE workspace_state SET generation=generation+1 WHERE owner_id=NEW.owner_id;
END;
CREATE TRIGGER radar_jobs_generation_delete AFTER DELETE ON radar_opportunities BEGIN
 UPDATE workspace_state SET generation=generation+1 WHERE owner_id=OLD.owner_id;
END;
CREATE TRIGGER radar_detach_record AFTER DELETE ON records WHEN OLD.kind IN ('company','asset') BEGIN
 UPDATE radar_settings SET payload=json_set(payload,
  '$.resumeId',CASE WHEN json_extract(payload,'$.resumeId')=OLD.id THEN '' ELSE json_extract(payload,'$.resumeId') END,
  '$.sources',json((SELECT json_group_array(json_set(value,
   '$.companyId',CASE WHEN json_extract(value,'$.companyId')=OLD.id THEN '' ELSE json_extract(value,'$.companyId') END,
   '$.enabled',json(CASE WHEN json_extract(value,'$.companyId')=OLD.id THEN 'false' WHEN json_extract(value,'$.enabled')=1 THEN 'true' ELSE 'false' END))) FROM json_each(payload,'$.sources')))),
  version=version+1 WHERE owner_id=OLD.owner_id AND (json_extract(payload,'$.resumeId')=OLD.id OR EXISTS(SELECT 1 FROM json_each(payload,'$.sources') WHERE json_extract(value,'$.companyId')=OLD.id));
 UPDATE radar_opportunities SET payload=json_set(payload,'$.companyId',''),version=version+1 WHERE owner_id=OLD.owner_id AND json_extract(payload,'$.companyId')=OLD.id;
END;

-- Company records now identify Interested directly; remove the redundant old flag.
UPDATE records SET data=json_remove(data,'$.radar'),version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE kind='company' AND json_type(data,'$.radar') IS NOT NULL;
