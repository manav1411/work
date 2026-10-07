-- Testing workspaces are intentionally reset. Authentication is retained.
DROP TRIGGER IF EXISTS goal_direction_insert;
DROP TRIGGER IF EXISTS goal_direction_update;
DROP TRIGGER IF EXISTS detach_goal_direction;
DROP TRIGGER IF EXISTS records_insert;
DROP TRIGGER IF EXISTS records_update;
DROP TRIGGER IF EXISTS records_delete;
DROP TABLE IF EXISTS record_file_links;
DROP TABLE IF EXISTS import_changes;
DROP TABLE IF EXISTS import_sources;
DROP TABLE IF EXISTS import_batches;
DROP TABLE IF EXISTS connector_sources;
DROP TABLE IF EXISTS connector_activity;
DROP TABLE IF EXISTS connector_runs;
DROP TABLE IF EXISTS connector_oauth_states;
DROP TABLE IF EXISTS connector_webhook_subscriptions;
DROP TABLE IF EXISTS connector_deliveries;
DROP TABLE IF EXISTS connector_connections;
DROP TABLE IF EXISTS backup_restore_files;
DROP TABLE IF EXISTS backup_restore_sessions;
DROP TABLE IF EXISTS record_revisions;
DROP TABLE IF EXISTS records_fts;
DROP TABLE IF EXISTS goals;
DROP TABLE IF EXISTS attachments;
DROP TABLE IF EXISTS record_links;
DROP TABLE IF EXISTS records;
DROP TABLE IF EXISTS preferences;
DROP TABLE IF EXISTS learning_source_cache;
DROP TABLE IF EXISTS idempotency;

CREATE TABLE records (
 id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('note','company','application','interview','story','topic','asset','path','decision','resource','rotation')),
 title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(tags)),
 links TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(links)), data TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(data)),
 version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(id,owner_id)
);
CREATE INDEX records_owner_kind_idx ON records(owner_id,kind);
CREATE TABLE record_links (
 owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, source_id TEXT NOT NULL, target_id TEXT NOT NULL,
 PRIMARY KEY(owner_id,source_id,target_id),
 FOREIGN KEY(source_id,owner_id) REFERENCES records(id,owner_id) ON DELETE CASCADE,
 FOREIGN KEY(target_id,owner_id) REFERENCES records(id,owner_id) ON DELETE CASCADE
);
CREATE INDEX record_links_target_idx ON record_links(owner_id,target_id);
CREATE VIRTUAL TABLE records_fts USING fts5(id UNINDEXED, owner_id UNINDEXED, title, body, tags, data, tokenize='unicode61 remove_diacritics 2');
CREATE TRIGGER records_insert AFTER INSERT ON records BEGIN
 INSERT INTO records_fts(id,owner_id,title,body,tags,data) VALUES(NEW.id,NEW.owner_id,NEW.title,NEW.body,NEW.tags,NEW.data);
END;
CREATE TRIGGER records_update AFTER UPDATE ON records BEGIN
 DELETE FROM records_fts WHERE id=OLD.id;
 INSERT INTO records_fts(id,owner_id,title,body,tags,data) VALUES(NEW.id,NEW.owner_id,NEW.title,NEW.body,NEW.tags,NEW.data);
END;
CREATE TRIGGER records_delete AFTER DELETE ON records BEGIN DELETE FROM records_fts WHERE id=OLD.id; END;
CREATE TABLE attachments (
 id TEXT PRIMARY KEY NOT NULL,owner_id TEXT NOT NULL,record_id TEXT NOT NULL,object_key TEXT NOT NULL UNIQUE,
 filename TEXT NOT NULL,content_type TEXT NOT NULL,size INTEGER NOT NULL,created_at TEXT NOT NULL,
 FOREIGN KEY(record_id,owner_id) REFERENCES records(id,owner_id) ON DELETE CASCADE
);
CREATE INDEX attachments_owner_record_idx ON attachments(owner_id,record_id);
CREATE TABLE preferences (owner_id TEXT PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE,data TEXT NOT NULL CHECK(json_valid(data)),updated_at TEXT NOT NULL);
CREATE TABLE goals (id TEXT PRIMARY KEY NOT NULL,owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,payload TEXT NOT NULL CHECK(json_valid(payload)),version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE INDEX goals_owner_idx ON goals(owner_id);
CREATE TRIGGER goal_direction_insert BEFORE INSERT ON goals WHEN COALESCE(json_extract(NEW.payload,'$.directionId'),'')!='' AND NOT EXISTS(SELECT 1 FROM records WHERE id=json_extract(NEW.payload,'$.directionId') AND owner_id=NEW.owner_id AND kind IN ('path','rotation','decision')) BEGIN SELECT RAISE(ABORT,'INVALID_DIRECTION'); END;
CREATE TRIGGER goal_direction_update BEFORE UPDATE OF payload ON goals WHEN COALESCE(json_extract(NEW.payload,'$.directionId'),'')!='' AND NOT EXISTS(SELECT 1 FROM records WHERE id=json_extract(NEW.payload,'$.directionId') AND owner_id=NEW.owner_id AND kind IN ('path','rotation','decision')) BEGIN SELECT RAISE(ABORT,'INVALID_DIRECTION'); END;
CREATE TRIGGER detach_goal_direction AFTER DELETE ON records BEGIN UPDATE goals SET payload=json_set(payload,'$.directionId',''),version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE owner_id=OLD.owner_id AND json_extract(payload,'$.directionId')=OLD.id; END;
CREATE TABLE learning_source_cache (owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,source_key TEXT NOT NULL,payload TEXT NOT NULL CHECK(json_valid(payload)),fetched_at TEXT NOT NULL,PRIMARY KEY(owner_id,source_key));
CREATE TABLE idempotency (owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,key TEXT NOT NULL,hash TEXT NOT NULL,response TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(owner_id,key));
CREATE TABLE workspace_state (owner_id TEXT PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE,epoch TEXT NOT NULL DEFAULT (lower(hex(randomblob(16)))),generation INTEGER NOT NULL DEFAULT 0);
CREATE TABLE workspace_uploads (id TEXT PRIMARY KEY NOT NULL,owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,generation INTEGER NOT NULL,epoch TEXT NOT NULL,expires_at TEXT NOT NULL,committed_at TEXT,response TEXT);
CREATE TABLE workspace_upload_files (upload_id TEXT NOT NULL REFERENCES workspace_uploads(id) ON DELETE CASCADE,original_id TEXT NOT NULL,payload TEXT NOT NULL,checksum TEXT,uploaded_at TEXT,PRIMARY KEY(upload_id,original_id));
CREATE TABLE file_cleanup (object_key TEXT PRIMARY KEY NOT NULL,owner_id TEXT NOT NULL);
CREATE TRIGGER records_generation_insert AFTER INSERT ON records BEGIN INSERT INTO workspace_state(owner_id,generation) VALUES(NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET generation=generation+1; END;
CREATE TRIGGER records_generation_update AFTER UPDATE ON records BEGIN INSERT INTO workspace_state(owner_id,generation) VALUES(NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET generation=generation+1; END;
CREATE TRIGGER records_generation_delete AFTER DELETE ON records BEGIN UPDATE workspace_state SET generation=generation+1 WHERE owner_id=OLD.owner_id; END;
CREATE TRIGGER attachments_generation_insert AFTER INSERT ON attachments BEGIN INSERT INTO workspace_state(owner_id,generation) VALUES(NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET generation=generation+1; END;
CREATE TRIGGER attachments_generation_update AFTER UPDATE ON attachments BEGIN INSERT INTO workspace_state(owner_id,generation) VALUES(NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET generation=generation+1; END;
CREATE TRIGGER attachments_generation_delete AFTER DELETE ON attachments BEGIN UPDATE workspace_state SET generation=generation+1 WHERE owner_id=OLD.owner_id; END;
CREATE TRIGGER goals_generation_insert AFTER INSERT ON goals BEGIN INSERT INTO workspace_state(owner_id,generation) VALUES(NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET generation=generation+1; END;
CREATE TRIGGER goals_generation_update AFTER UPDATE ON goals BEGIN INSERT INTO workspace_state(owner_id,generation) VALUES(NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET generation=generation+1; END;
CREATE TRIGGER goals_generation_delete AFTER DELETE ON goals BEGIN UPDATE workspace_state SET generation=generation+1 WHERE owner_id=OLD.owner_id; END;
CREATE TRIGGER preferences_generation_insert AFTER INSERT ON preferences BEGIN INSERT INTO workspace_state(owner_id,generation) VALUES(NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET generation=generation+1; END;
CREATE TRIGGER preferences_generation_update AFTER UPDATE ON preferences BEGIN INSERT INTO workspace_state(owner_id,generation) VALUES(NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET generation=generation+1; END;
CREATE TRIGGER preferences_generation_delete AFTER DELETE ON preferences BEGIN UPDATE workspace_state SET generation=generation+1 WHERE owner_id=OLD.owner_id; END;
