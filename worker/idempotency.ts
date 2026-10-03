import { ApiError, now } from "./env";
import { hashValue, idempotencyKeySchema, parse } from "./validation";
import { fromRow, type RecordRow } from "./db/records";
import type { WorkRecord } from "../shared/model";

interface SavedRequest {
  hash: string;
  response: string;
}
interface SavedReferences {
  field: "record" | "records";
  refs: { id: string; version: number }[];
}
function encodeResponse(response: unknown): string {
  if (!response || typeof response !== "object")
    return JSON.stringify(response);
  const value = { ...response } as Record<string, unknown>;
  for (const field of ["record", "records"] as const) {
    if (!value[field]) continue;
    const records = (
      field === "record" ? [value[field]] : value[field]
    ) as WorkRecord[];
    value.$workRecords = {
      field,
      refs: records.map((record) => ({
        id: record.id,
        version: record.version,
      })),
    } satisfies SavedReferences;
    delete value[field];
  }
  return JSON.stringify(value);
}
async function decodeResponse(
  db: D1Database,
  owner: string,
  response: string,
): Promise<unknown> {
  const value = JSON.parse(response) as Record<string, unknown>;
  const references = value.$workRecords as SavedReferences | undefined;
  if (!references) return value;
  const rows = await db
    .prepare(
      `SELECT r.id,r.owner_id,r.kind,v.title,v.body,v.tags,v.links,v.data,v.version,r.created_at,v.created_at AS updated_at,v.deleted_at FROM records r JOIN record_revisions v ON v.record_id=r.id AND v.owner_id=r.owner_id JOIN json_each(?) refs ON r.id=json_extract(refs.value,'$.id') AND v.version=json_extract(refs.value,'$.version') WHERE r.owner_id=?`,
    )
    .bind(JSON.stringify(references.refs), owner)
    .all<RecordRow>();
  const records = new Map(rows.results.map((row) => [row.id, fromRow(row)]));
  if (references.refs.some((ref) => !records.has(ref.id)))
    throw new ApiError(
      409,
      "IDEMPOTENCY_RECORD_REMOVED",
      "This request was already completed, but one of its records has since been permanently deleted.",
    );
  const ordered = references.refs.map((ref) => records.get(ref.id)!);
  delete value.$workRecords;
  value[references.field] =
    references.field === "record" ? ordered[0] : ordered;
  return value;
}
export async function checkIdempotency(
  db: D1Database,
  owner: string,
  key: string | undefined,
  value: unknown,
): Promise<{ key?: string; hash: string; response?: unknown }> {
  const hash = await hashValue(value);
  if (!key) return { hash };
  parse(idempotencyKeySchema, key);
  const saved = await db
    .prepare("SELECT hash,response FROM idempotency WHERE owner_id=? AND key=?")
    .bind(owner, key)
    .first<SavedRequest>();
  if (saved && saved.hash !== hash)
    throw new ApiError(
      409,
      "IDEMPOTENCY_CONFLICT",
      "This request key was already used for different content.",
    );
  return {
    key,
    hash,
    response: saved
      ? await decodeResponse(db, owner, saved.response)
      : undefined,
  };
}
export function idempotencyStatement(
  db: D1Database,
  owner: string,
  state: { key?: string; hash: string },
  response: unknown,
): D1PreparedStatement[] {
  return state.key
    ? [
        db
          .prepare(
            "INSERT INTO idempotency(owner_id,key,hash,response,created_at) VALUES(?,?,?,?,?)",
          )
          .bind(owner, state.key, state.hash, encodeResponse(response), now()),
      ]
    : [];
}
export async function raceResponse(
  db: D1Database,
  owner: string,
  state: { key?: string; hash: string },
): Promise<unknown | undefined> {
  if (!state.key) return;
  const saved = await db
    .prepare("SELECT hash,response FROM idempotency WHERE owner_id=? AND key=?")
    .bind(owner, state.key)
    .first<SavedRequest>();
  if (saved?.hash === state.hash)
    return decodeResponse(db, owner, saved.response);
}
