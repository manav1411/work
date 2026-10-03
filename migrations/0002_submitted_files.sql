-- Keep files captured in applications until their captured references are removed.
CREATE UNIQUE INDEX attachments_identity_owner_idx ON attachments(id, owner_id);
CREATE TABLE record_file_links (
  owner_id TEXT NOT NULL, source_id TEXT NOT NULL, attachment_id TEXT NOT NULL,
  PRIMARY KEY(owner_id, source_id, attachment_id),
  FOREIGN KEY(source_id, owner_id) REFERENCES records(id, owner_id) ON DELETE CASCADE,
  FOREIGN KEY(attachment_id, owner_id) REFERENCES attachments(id, owner_id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX record_file_links_attachment_idx ON record_file_links(owner_id, attachment_id);
INSERT INTO record_file_links(owner_id, source_id, attachment_id)
  SELECT DISTINCT r.owner_id, r.id, a.id FROM records r
  JOIN json_tree(r.data) j ON j.key = 'attachmentId'
  JOIN attachments a ON a.id = j.value AND a.owner_id = r.owner_id
  WHERE r.kind = 'application';
