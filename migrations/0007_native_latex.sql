-- Build progress uses a separate CAS namespace without changing source version.
-- Keep search current, but only authored version changes create revisions.
DROP TRIGGER records_update;
CREATE TRIGGER records_update AFTER UPDATE ON records BEGIN
  DELETE FROM records_fts WHERE id = OLD.id;
  INSERT INTO records_fts(id, owner_id, title, body, tags, data)
    SELECT NEW.id, NEW.owner_id, NEW.title, NEW.body, NEW.tags, NEW.data WHERE NEW.deleted_at IS NULL;
  INSERT INTO record_revisions(id, record_id, owner_id, version, title, body, tags, links, data, created_at, deleted_at)
    SELECT NEW.id || ':' || NEW.version, NEW.id, NEW.owner_id, NEW.version, NEW.title, NEW.body, NEW.tags, NEW.links, NEW.data, NEW.updated_at, NEW.deleted_at
    WHERE NEW.version != OLD.version;
END;

-- Submitted native source/PDF files and fork baselines need the same physical
-- deletion protection as legacy submitted application attachments.
INSERT OR IGNORE INTO record_file_links(owner_id, source_id, attachment_id)
  SELECT r.owner_id, r.id, a.id FROM records r
  JOIN json_tree(r.data) j ON ((j.fullkey LIKE '$.submissions[%' AND j.key IN ('revisionId','pdfAttachmentId')) OR j.key='forkRevisionId')
  JOIN attachments a ON a.id=j.value AND a.owner_id=r.owner_id
  WHERE r.kind='asset';
