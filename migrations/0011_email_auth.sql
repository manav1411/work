ALTER TABLE user ADD COLUMN registration_proof TEXT NOT NULL DEFAULT '';
ALTER TABLE user ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE session ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0;

-- Fail on ambiguous legacy identities instead of merging their workspaces.
CREATE UNIQUE INDEX user_email_normalized_idx ON user(lower(trim(email)));
UPDATE user SET email=lower(trim(email));
CREATE INDEX user_pending_registration_idx ON user(email_verified,created_at);

-- Only the newest transient challenge for an identifier survives cutover.
DELETE FROM verification WHERE rowid NOT IN (SELECT MAX(rowid) FROM verification GROUP BY identifier);
CREATE UNIQUE INDEX verification_identifier_unique_idx ON verification(identifier);

CREATE TABLE auth_limits (
  key TEXT PRIMARY KEY NOT NULL,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX auth_limits_expiry_idx ON auth_limits(expires_at);

CREATE TABLE auth_mail (
  id TEXT PRIMARY KEY NOT NULL,
  verification_id TEXT NOT NULL UNIQUE REFERENCES verification(id) ON DELETE CASCADE,
  payload TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  lease_until INTEGER NOT NULL DEFAULT 0,
  delivered_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX auth_mail_pending_idx ON auth_mail(delivered_at,next_attempt_at,lease_until);

-- Password/session changes commit together even though the auth adapter cannot
-- open interactive D1 transactions. Session inserts also reject a login that
-- verified an old password concurrently with a successful reset.
CREATE TRIGGER credential_insert_revoke AFTER INSERT ON account
WHEN NEW.provider_id='credential' BEGIN
  UPDATE user SET auth_version=auth_version+1 WHERE id=NEW.user_id;
  DELETE FROM session WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER credential_update_revoke AFTER UPDATE OF password ON account
WHEN NEW.provider_id='credential' AND NEW.password IS NOT OLD.password BEGIN
  UPDATE user SET auth_version=auth_version+1,registration_proof='' WHERE id=NEW.user_id;
  DELETE FROM session WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER session_auth_version BEFORE INSERT ON session
WHEN NEW.auth_version != (SELECT auth_version FROM user WHERE id=NEW.user_id)
BEGIN SELECT RAISE(ABORT,'STALE_AUTHENTICATION'); END;

CREATE TRIGGER user_email_revoke AFTER UPDATE OF email ON user
WHEN lower(NEW.email) != lower(OLD.email) BEGIN
  UPDATE user SET auth_version=auth_version+1,email_verified=0,registration_proof='' WHERE id=NEW.id;
  DELETE FROM session WHERE user_id=NEW.id;
END;
