-- Extend action associations without replacing any workspace content.
DROP TRIGGER goal_direction_insert;
DROP TRIGGER goal_direction_update;
DROP TRIGGER detach_goal_direction;

CREATE TRIGGER goal_direction_insert BEFORE INSERT ON goals
WHEN json_array_length(COALESCE(json_extract(NEW.payload,'$.goalIds'), CASE WHEN COALESCE(json_extract(NEW.payload,'$.directionId'),'')='' THEN '[]' ELSE json_array(json_extract(NEW.payload,'$.directionId')) END))=0 OR EXISTS (
 SELECT 1 FROM json_each(COALESCE(json_extract(NEW.payload,'$.goalIds'),
 CASE WHEN COALESCE(json_extract(NEW.payload,'$.directionId'),'')='' THEN '[]' ELSE json_array(json_extract(NEW.payload,'$.directionId')) END)) AS linked
 WHERE NOT EXISTS (SELECT 1 FROM records WHERE id=linked.value AND owner_id=NEW.owner_id AND kind IN ('path','rotation','decision'))
) BEGIN SELECT RAISE(ABORT,'INVALID_DIRECTION'); END;

CREATE TRIGGER goal_direction_update BEFORE UPDATE OF payload ON goals
WHEN json_array_length(COALESCE(json_extract(NEW.payload,'$.goalIds'), CASE WHEN COALESCE(json_extract(NEW.payload,'$.directionId'),'')='' THEN '[]' ELSE json_array(json_extract(NEW.payload,'$.directionId')) END))=0 OR EXISTS (
 SELECT 1 FROM json_each(COALESCE(json_extract(NEW.payload,'$.goalIds'),
 CASE WHEN COALESCE(json_extract(NEW.payload,'$.directionId'),'')='' THEN '[]' ELSE json_array(json_extract(NEW.payload,'$.directionId')) END)) AS linked
 WHERE NOT EXISTS (SELECT 1 FROM records WHERE id=linked.value AND owner_id=NEW.owner_id AND kind IN ('path','rotation','decision'))
) BEGIN SELECT RAISE(ABORT,'INVALID_DIRECTION'); END;

CREATE TRIGGER detach_goal_direction AFTER DELETE ON records BEGIN
 DELETE FROM goals WHERE owner_id=OLD.owner_id
 AND EXISTS (SELECT 1 FROM json_each(COALESCE(json_extract(payload,'$.goalIds'),json_array(json_extract(payload,'$.directionId')))) WHERE value=OLD.id)
 AND NOT EXISTS (SELECT 1 FROM json_each(COALESCE(json_extract(payload,'$.goalIds'),json_array(json_extract(payload,'$.directionId')))) WHERE value!=OLD.id);
 UPDATE goals SET
 payload=json_set(payload,
 '$.goalIds',json((SELECT json_group_array(value) FROM json_each(COALESCE(json_extract(payload,'$.goalIds'),json_array(json_extract(payload,'$.directionId')))) WHERE value!=OLD.id)),
 '$.directionId',COALESCE((SELECT value FROM json_each(COALESCE(json_extract(payload,'$.goalIds'),json_array(json_extract(payload,'$.directionId')))) WHERE value!=OLD.id ORDER BY key LIMIT 1),'')),
 version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE owner_id=OLD.owner_id AND EXISTS (
 SELECT 1 FROM json_each(COALESCE(json_extract(payload,'$.goalIds'),json_array(json_extract(payload,'$.directionId')))) WHERE value=OLD.id
 );
END;
