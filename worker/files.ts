import type { Attachment } from "../shared/model";
import { ApiError, id, now, type Env } from "./env";
import {
  attachmentFromRow,
  type AttachmentRow,
  getRecord,
  jsonChunks,
} from "./db/records";
import { attachmentTypes, filename, MAX_FILE_BYTES } from "./validation";

export function validateFile(contentType: string, bytes: Uint8Array) {
  if (!attachmentTypes.has(contentType))
    throw new ApiError(
      415,
      "FILE_TYPE_NOT_ALLOWED",
      "Upload a PDF, common image format, plain text, Markdown, CSV, or JSON.",
    );
  if (!bytes.length || bytes.length > MAX_FILE_BYTES)
    throw new ApiError(
      413,
      "FILE_TOO_LARGE",
      "Each file must contain data and be no larger than 10 MB.",
    );
  const starts = (...signature: number[]) =>
    signature.every((byte, index) => bytes[index] === byte);
  if (
    (contentType === "application/pdf" &&
      !starts(0x25, 0x50, 0x44, 0x46, 0x2d)) ||
    (contentType === "image/png" &&
      !starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) ||
    (contentType === "image/jpeg" && !starts(0xff, 0xd8, 0xff)) ||
    (contentType === "image/gif" && !starts(0x47, 0x49, 0x46, 0x38)) ||
    (contentType === "image/webp" &&
      (!starts(0x52, 0x49, 0x46, 0x46) ||
        new TextDecoder().decode(bytes.slice(8, 12)) !== "WEBP"))
  ) {
    throw new ApiError(
      415,
      "FILE_TYPE_MISMATCH",
      "The file contents do not match its declared format.",
    );
  }
}

export async function prepareAttachment(
  env: Env,
  owner: string,
  recordId: string,
  name: string,
  contentType: string,
  bytes: Uint8Array,
): Promise<AttachmentRow> {
  validateFile(contentType, bytes);
  const attachmentId = id();
  const objectKey = `${owner}/${recordId}/${attachmentId}`;
  await env.FILES.put(objectKey, bytes, {
    httpMetadata: { contentType },
    customMetadata: { owner, recordId },
  });
  return {
    id: attachmentId,
    owner_id: owner,
    record_id: recordId,
    object_key: objectKey,
    filename: filename(name),
    content_type: contentType,
    size: bytes.length,
    created_at: now(),
  };
}
export function insertAttachment(
  db: D1Database,
  row: AttachmentRow,
): D1PreparedStatement {
  return db
    .prepare(
      "INSERT INTO attachments(id,owner_id,record_id,object_key,filename,content_type,size,created_at) VALUES(?,?,?,?,?,?,?,?)",
    )
    .bind(
      row.id,
      row.owner_id,
      row.record_id,
      row.object_key,
      row.filename,
      row.content_type,
      row.size,
      row.created_at,
    );
}
export function bulkInsertAttachments(
  db: D1Database,
  rows: AttachmentRow[],
): D1PreparedStatement[] {
  return jsonChunks(rows).map((chunk) =>
    db
      .prepare(
        "INSERT INTO attachments(id,owner_id,record_id,object_key,filename,content_type,size,created_at) SELECT json_extract(value,'$.id'),json_extract(value,'$.owner_id'),json_extract(value,'$.record_id'),json_extract(value,'$.object_key'),json_extract(value,'$.filename'),json_extract(value,'$.content_type'),json_extract(value,'$.size'),json_extract(value,'$.created_at') FROM json_each(?)",
      )
      .bind(chunk),
  );
}
export async function saveAttachment(
  env: Env,
  owner: string,
  recordId: string,
  name: string,
  contentType: string,
  bytes: Uint8Array,
): Promise<Attachment> {
  await getRecord(env.DB, owner, recordId);
  const row = await prepareAttachment(
    env,
    owner,
    recordId,
    name,
    contentType,
    bytes,
  );
  try {
    await insertAttachment(env.DB, row).run();
  } catch (error) {
    await env.FILES.delete(row.object_key);
    throw error;
  }
  return attachmentFromRow(row);
}
export async function getAttachment(
  env: Env,
  owner: string,
  attachmentId: string,
): Promise<AttachmentRow> {
  const row = await env.DB.prepare(
    "SELECT a.* FROM attachments a JOIN records r ON r.id=a.record_id AND r.owner_id=a.owner_id WHERE a.id=? AND a.owner_id=? AND r.deleted_at IS NULL AND COALESCE(json_extract(r.data,'$.connectorSource.available'),1)!=0",
  )
    .bind(attachmentId, owner)
    .first<AttachmentRow>();
  if (!row)
    throw new ApiError(404, "NOT_FOUND", "This attachment was not found.");
  return row;
}
export async function assertFilesNotSubmitted(
  db: D1Database,
  owner: string,
  attachmentIds: string[],
) {
  if (!attachmentIds.length) return;
  const references = await db
    .prepare(
      "SELECT DISTINCT r.id,r.title FROM records r JOIN json_tree(r.data) j ON j.key='attachmentId' AND j.value IN (SELECT value FROM json_each(?)) WHERE r.owner_id=? AND r.kind='application'",
    )
    .bind(JSON.stringify(attachmentIds), owner)
    .all<{ id: string; title: string }>();
  if (references.results.length)
    throw new ApiError(
      409,
      "FILE_IN_USE",
      "This file was captured as an application document. Remove the captured version from those applications before deleting it.",
      { applications: references.results },
    );
}
export async function assertRecordFilesNotSubmitted(
  db: D1Database,
  owner: string,
  recordId: string,
) {
  const files = await db
    .prepare("SELECT id FROM attachments WHERE owner_id=? AND record_id=?")
    .bind(owner, recordId)
    .all<{ id: string }>();
  await assertFilesNotSubmitted(
    db,
    owner,
    files.results.map((file) => file.id),
  );
}
export function toBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 8192)
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
  return btoa(chunks.join(""));
}
export function fromBase64(base64: string): Uint8Array {
  try {
    return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  } catch {
    throw new ApiError(
      400,
      "INVALID_FILE",
      "An imported attachment has invalid base64 contents.",
    );
  }
}
