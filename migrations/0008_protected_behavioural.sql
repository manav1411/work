-- Restore the built-in STAR story-bank tab without deleting authored content.
UPDATE records SET deleted_at=NULL,
  data=json_set(data,'$.hidden',json('false')),
  version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE kind='note' AND json_extract(data,'$.category')='interview-tab'
  AND json_extract(data,'$.tabKey')='behavioural'
  AND (deleted_at IS NOT NULL OR json_extract(data,'$.hidden')=1);
