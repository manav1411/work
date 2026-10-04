-- Retire provider access while retaining imports, history and GitHub sign-in.
-- Copy an existing public LeetCode username only when no preference is set.
INSERT INTO preferences(owner_id,data,updated_at)
SELECT owner_id, json_object('leetcode','https://leetcode.com/u/' || json_extract(config,'$.username') || '/'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM connector_connections
WHERE provider='leetcode' AND length(json_extract(config,'$.username')) BETWEEN 1 AND 40
  AND json_extract(config,'$.username') NOT GLOB '*[^a-zA-Z0-9_-]*'
ON CONFLICT(owner_id) DO UPDATE SET
  data=json_set(preferences.data,'$.leetcode',json_extract(excluded.data,'$.leetcode')),
  updated_at=excluded.updated_at
WHERE COALESCE(json_extract(preferences.data,'$.leetcode'),'')='';

UPDATE records SET data=json_set(data,'$.connectorSource.detached',json('true')),
  version=version+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE json_type(data,'$.connectorSource')='object'
  AND COALESCE(json_extract(data,'$.connectorSource.detached'),0)!=1;

UPDATE connector_connections SET status='disconnected', credential=NULL,
  generation=generation+1, lease_token=NULL, lease_until=NULL,
  next_sync_at=NULL, error=NULL
WHERE status!='disconnected' OR credential IS NOT NULL OR lease_token IS NOT NULL OR next_sync_at IS NOT NULL;
DELETE FROM connector_oauth_states;
UPDATE connector_webhook_subscriptions SET credential=NULL;

-- Persist company names independently of optional radar relationships.
UPDATE records SET data=json_set(data,'$.company',(
  SELECT company.title FROM records company
  WHERE company.id=json_extract(records.data,'$.companyId')
    AND company.owner_id=records.owner_id AND company.kind='company'
)), version=version+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE kind='application' AND COALESCE(json_extract(data,'$.company'),'')=''
  AND EXISTS(SELECT 1 FROM records company
    WHERE company.id=json_extract(records.data,'$.companyId')
      AND company.owner_id=records.owner_id AND company.kind='company');

CREATE TRIGGER IF NOT EXISTS goal_direction_insert BEFORE INSERT ON goals
WHEN COALESCE(json_extract(NEW.payload,'$.directionId'),'')!=''
 AND NOT EXISTS(SELECT 1 FROM records WHERE id=json_extract(NEW.payload,'$.directionId')
   AND owner_id=NEW.owner_id AND kind IN ('path','rotation','decision'))
BEGIN SELECT RAISE(ABORT,'INVALID_DIRECTION'); END;
CREATE TRIGGER IF NOT EXISTS detach_goal_direction AFTER DELETE ON records
WHEN OLD.kind IN ('path','rotation','decision')
BEGIN
  UPDATE goals SET payload=json_set(payload,'$.directionId',''),version=version+1,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE owner_id=OLD.owner_id AND json_extract(payload,'$.directionId')=OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS goal_direction_update BEFORE UPDATE OF payload ON goals
WHEN COALESCE(json_extract(NEW.payload,'$.directionId'),'')!=''
 AND NOT EXISTS(SELECT 1 FROM records WHERE id=json_extract(NEW.payload,'$.directionId')
   AND owner_id=NEW.owner_id AND kind IN ('path','rotation','decision'))
BEGIN SELECT RAISE(ABORT,'INVALID_DIRECTION'); END;
