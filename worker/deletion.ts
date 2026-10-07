import { dependentRecordIds } from "../shared/deletion";
import {
  fromRow,
  detachReferenceStatements,
  type RecordRow,
} from "./db/records";
import { type Env, id } from "./env";

export async function deletionStatements(
  env: Env,
  owner: string,
  initial: string[],
  excluded = "",
) {
  const rows = await env.DB.prepare("SELECT * FROM records WHERE owner_id=?")
    .bind(owner)
    .all<RecordRow>();
  const records = rows.results.map(fromRow),
    ids = dependentRecordIds(records, initial);
  const files = await env.DB.prepare(
    "SELECT id,object_key FROM attachments WHERE owner_id=? AND record_id IN (SELECT value FROM json_each(?))",
  )
    .bind(owner, JSON.stringify([...ids]))
    .all<{ id: string; object_key: string }>();
  const guard = id();
  return [
    env.DB.prepare(
      "INSERT INTO write_guards(id,value) SELECT ?, NOT EXISTS(SELECT id,version FROM records WHERE owner_id=? EXCEPT SELECT json_extract(value,'$.id'),json_extract(value,'$.version') FROM json_each(?))",
    ).bind(
      guard,
      owner,
      JSON.stringify(
        records.map((record) => ({ id: record.id, version: record.version })),
      ),
    ),
    env.DB.prepare("DELETE FROM write_guards WHERE id=?").bind(guard),
    ...(await detachReferenceStatements(
      env.DB,
      owner,
      [...ids],
      files.results.map((file) => file.id),
      excluded,
    )),
    env.DB.prepare(
      "INSERT OR IGNORE INTO file_cleanup(object_key,owner_id) SELECT object_key,owner_id FROM attachments WHERE owner_id=? AND record_id IN (SELECT value FROM json_each(?))",
    ).bind(owner, JSON.stringify([...ids])),
    env.DB.prepare(
      "DELETE FROM records WHERE owner_id=? AND id IN (SELECT value FROM json_each(?))",
    ).bind(owner, JSON.stringify([...ids])),
  ];
}
