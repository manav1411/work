import type { Attachment, RecordInput, WorkRecord } from "../../shared/model";
import { ApiError, id, now } from "../env";

export interface RecordRow {
  id: string;
  owner_id: string;
  kind: WorkRecord["kind"];
  title: string;
  body: string;
  tags: string;
  links: string;
  data: string;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}
export interface AttachmentRow {
  id: string;
  owner_id: string;
  record_id: string;
  object_key: string;
  filename: string;
  content_type: string;
  size: number;
  created_at: string;
}
export const fromRow = (row: RecordRow): WorkRecord => ({
  id: row.id,
  kind: row.kind,
  title: row.title,
  body: row.body,
  tags: JSON.parse(row.tags),
  links: JSON.parse(row.links),
  data: JSON.parse(row.data),
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  deletedAt: row.deleted_at,
});
export const attachmentFromRow = (row: AttachmentRow): Attachment => ({
  id: row.id,
  recordId: row.record_id,
  filename: row.filename,
  contentType: row.content_type,
  size: row.size,
  createdAt: row.created_at,
});

export async function getRecord(
  db: D1Database,
  owner: string,
  recordId: string,
  includeDeleted = false,
): Promise<WorkRecord> {
  const row = await db
    .prepare(
      `SELECT * FROM records WHERE id=? AND owner_id=? ${includeDeleted ? "" : "AND deleted_at IS NULL"}`,
    )
    .bind(recordId, owner)
    .first<RecordRow>();
  if (!row) throw new ApiError(404, "NOT_FOUND", "This record was not found.");
  return fromRow(row);
}

export async function validateLinks(
  db: D1Database,
  owner: string,
  links: string[],
  allowed = new Set<string>(),
) {
  const check = links.filter((link) => !allowed.has(link));
  if (!check.length) return;
  const rows = await db
    .prepare(
      "SELECT id FROM records WHERE owner_id=? AND deleted_at IS NULL AND id IN (SELECT value FROM json_each(?))",
    )
    .bind(owner, JSON.stringify(check))
    .all<{ id: string }>();
  if (rows.results.length !== check.length)
    throw new ApiError(
      400,
      "INVALID_LINK",
      "Linked records must exist in your workspace.",
    );
}

export function dataReferences(data: Record<string, unknown>): {
  records: string[];
  files: string[];
} {
  const recordKeys = new Set([
    "companyId",
    "applicationId",
    "contactId",
    "assetId",
    "projectId",
    "achievementId",
    "rotationId",
    "actionId",
    "decisionId",
    "recordId",
  ]);
  const fileKeys = new Set(["attachmentId", "primaryAttachmentId"]);
  const records = new Set<string>();
  const files = new Set<string>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (typeof child === "string" && child) {
        if (
          recordKeys.has(key) ||
          (["problemId", "topicId"].includes(key) &&
            /^[0-9a-f-]{36}$/i.test(child))
        )
          records.add(child);
        if (fileKeys.has(key)) files.add(child);
      }
      if (
        Array.isArray(child) &&
        ["assetIds", "recordIds", "companyIds"].includes(key)
      )
        for (const item of child)
          if (typeof item === "string" && item) records.add(item);
      if (child && typeof child === "object") visit(child);
    }
  };
  visit(data);
  return { records: [...records], files: [...files] };
}
export async function validateDataReferences(
  db: D1Database,
  owner: string,
  data: Record<string, unknown>,
  allowedRecords = new Set<string>(),
  allowedFiles = new Set<string>(),
) {
  const references = dataReferences(data);
  const records = references.records.filter(
    (value) => !allowedRecords.has(value),
  );
  const files = references.files.filter((value) => !allowedFiles.has(value));
  if (records.length) {
    const result = await db
      .prepare(
        "SELECT id FROM records WHERE owner_id=? AND id IN (SELECT value FROM json_each(?))",
      )
      .bind(owner, JSON.stringify(records))
      .all<{ id: string }>();
    if (result.results.length !== records.length)
      throw new ApiError(
        400,
        "INVALID_REFERENCE",
        "Related records in the details must belong to your workspace.",
      );
  }
  if (files.length) {
    const result = await db
      .prepare(
        "SELECT id FROM attachments WHERE owner_id=? AND id IN (SELECT value FROM json_each(?))",
      )
      .bind(owner, JSON.stringify(files))
      .all<{ id: string }>();
    if (result.results.length !== files.length)
      throw new ApiError(
        400,
        "INVALID_REFERENCE",
        "Related attachments must belong to your workspace.",
      );
  }
}

export function newRecord(input: RecordInput, recordId = id()): WorkRecord {
  const timestamp = now();
  return {
    ...input,
    id: recordId,
    body: input.body || "",
    tags: input.tags || [],
    links: input.links || [],
    data: input.data || {},
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
}
export function insertRecord(
  db: D1Database,
  owner: string,
  record: WorkRecord,
): D1PreparedStatement {
  return db
    .prepare(
      "INSERT INTO records(id,owner_id,kind,title,body,tags,links,data,version,created_at,updated_at,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .bind(
      record.id,
      owner,
      record.kind,
      record.title,
      record.body,
      JSON.stringify(record.tags),
      JSON.stringify(record.links),
      JSON.stringify(record.data),
      record.version,
      record.createdAt,
      record.updatedAt,
      record.deletedAt,
    );
}
export function updateRecord(
  db: D1Database,
  owner: string,
  record: WorkRecord,
  expectedVersion: number,
): D1PreparedStatement {
  return db
    .prepare(
      "UPDATE records SET title=?,body=?,tags=?,links=?,data=?,version=?,updated_at=?,deleted_at=? WHERE id=? AND owner_id=? AND version=?",
    )
    .bind(
      record.title,
      record.body,
      JSON.stringify(record.tags),
      JSON.stringify(record.links),
      JSON.stringify(record.data),
      record.version,
      record.updatedAt,
      record.deletedAt,
      record.id,
      owner,
      expectedVersion,
    );
}
export function linkStatements(
  db: D1Database,
  owner: string,
  record: WorkRecord,
): D1PreparedStatement[] {
  return [
    db
      .prepare("DELETE FROM record_links WHERE owner_id=? AND source_id=?")
      .bind(owner, record.id),
    ...insertLinks(db, owner, record),
  ];
}
export function insertLinks(
  db: D1Database,
  owner: string,
  record: WorkRecord,
): D1PreparedStatement[] {
  return record.links.length
    ? [
        db
          .prepare(
            "INSERT INTO record_links(owner_id,source_id,target_id) SELECT ?,?,value FROM json_each(?)",
          )
          .bind(owner, record.id, JSON.stringify(record.links)),
      ]
    : [];
}
export function assertChanged(db: D1Database): D1PreparedStatement[] {
  const guardId = id();
  return [
    db
      .prepare("INSERT INTO write_guards(id,value) VALUES(?,changes())")
      .bind(guardId),
    db.prepare("DELETE FROM write_guards WHERE id=?").bind(guardId),
  ];
}

// JSON table-valued inserts avoid D1's 100-parameter limit and keep normal
// workspace imports below the free plan's per-invocation query limit.
export function jsonChunks<T>(items: T[], maxBytes = 1_500_000): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let bytes = 2;
  for (const item of items) {
    const value = JSON.stringify(item);
    const size = new TextEncoder().encode(value).length + 1;
    if (size > maxBytes)
      throw new ApiError(
        413,
        "RECORD_TOO_LARGE",
        "An individual record is too large to save.",
      );
    if (bytes + size > maxBytes && current.length) {
      chunks.push(`[${current.join(",")}]`);
      current = [];
      bytes = 2;
    }
    current.push(value);
    bytes += size;
  }
  if (current.length) chunks.push(`[${current.join(",")}]`);
  return chunks;
}
export function bulkInsertRecords(
  db: D1Database,
  owner: string,
  records: WorkRecord[],
): D1PreparedStatement[] {
  return jsonChunks(records).map((chunk) =>
    db
      .prepare(
        `INSERT INTO records(id,owner_id,kind,title,body,tags,links,data,version,created_at,updated_at,deleted_at)
    SELECT json_extract(value,'$.id'),?,json_extract(value,'$.kind'),json_extract(value,'$.title'),json_extract(value,'$.body'),json_extract(value,'$.tags'),json_extract(value,'$.links'),json_extract(value,'$.data'),json_extract(value,'$.version'),json_extract(value,'$.createdAt'),json_extract(value,'$.updatedAt'),json_extract(value,'$.deletedAt') FROM json_each(?)`,
      )
      .bind(owner, chunk),
  );
}
export function bulkInsertLinks(
  db: D1Database,
  owner: string,
  records: WorkRecord[],
): D1PreparedStatement[] {
  return jsonChunks(
    records
      .filter((record) => record.links.length)
      .map((record) => ({ id: record.id, links: record.links })),
  ).map((chunk) =>
    db
      .prepare(
        "INSERT INTO record_links(owner_id,source_id,target_id) SELECT ?,json_extract(r.value,'$.id'),l.value FROM json_each(?) r JOIN json_each(json_extract(r.value,'$.links')) l",
      )
      .bind(owner, chunk),
  );
}
export function bulkUpdateRecords(
  db: D1Database,
  owner: string,
  records: { record: WorkRecord; expectedVersion: number }[],
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  for (const chunk of jsonChunks(
    records.map(({ record, expectedVersion }) => ({
      ...record,
      expectedVersion,
    })),
  )) {
    const guardId = id();
    const expected = (JSON.parse(chunk) as unknown[]).length;
    statements.push(
      db
        .prepare(
          `UPDATE records SET title=json_extract(item.value,'$.title'),body=json_extract(item.value,'$.body'),tags=json_extract(item.value,'$.tags'),links=json_extract(item.value,'$.links'),data=json_extract(item.value,'$.data'),version=json_extract(item.value,'$.version'),updated_at=json_extract(item.value,'$.updatedAt'),deleted_at=json_extract(item.value,'$.deletedAt') FROM json_each(?) item WHERE records.id=json_extract(item.value,'$.id') AND records.owner_id=? AND records.version=json_extract(item.value,'$.expectedVersion')`,
        )
        .bind(chunk, owner),
      db
        .prepare("INSERT INTO write_guards(id,value) VALUES(?,changes()=?)")
        .bind(guardId, expected),
      db.prepare("DELETE FROM write_guards WHERE id=?").bind(guardId),
    );
  }
  return statements;
}
export function bulkReplaceLinks(
  db: D1Database,
  owner: string,
  records: WorkRecord[],
): D1PreparedStatement[] {
  if (!records.length) return [];
  return [
    db
      .prepare(
        "DELETE FROM record_links WHERE owner_id=? AND source_id IN (SELECT json_extract(value,'$.id') FROM json_each(?))",
      )
      .bind(
        owner,
        JSON.stringify(records.map((record) => ({ id: record.id }))),
      ),
    ...bulkInsertLinks(db, owner, records),
  ];
}
export function applicationFileStatements(
  db: D1Database,
  owner: string,
  records: WorkRecord[],
): D1PreparedStatement[] {
  const applications = records.filter(
    (record) => record.kind === "application",
  );
  if (!applications.length) return [];
  return [
    db
      .prepare(
        "DELETE FROM record_file_links WHERE owner_id=? AND source_id IN (SELECT value FROM json_each(?))",
      )
      .bind(owner, JSON.stringify(applications.map((record) => record.id))),
    ...jsonChunks(
      applications
        .filter((record) => dataReferences(record.data).files.length)
        .map((record) => ({
          id: record.id,
          files: dataReferences(record.data).files,
        })),
    ).map((chunk) =>
      db
        .prepare(
          "INSERT INTO record_file_links(owner_id,source_id,attachment_id) SELECT ?,json_extract(r.value,'$.id'),f.value FROM json_each(?) r JOIN json_each(json_extract(r.value,'$.files')) f",
        )
        .bind(owner, chunk),
    ),
  ];
}

export async function writeRecord(
  db: D1Database,
  owner: string,
  record: WorkRecord,
  expectedVersion?: number,
  additionalStatements: D1PreparedStatement[] = [],
) {
  const original =
    expectedVersion === undefined
      ? null
      : await getRecord(db, owner, record.id, true);
  await validateLinks(db, owner, record.links, new Set(original?.links || []));
  await validateDataReferences(
    db,
    owner,
    record.data,
    new Set(original ? dataReferences(original.data).records : []),
    new Set(original ? dataReferences(original.data).files : []),
  );
  const statements =
    expectedVersion === undefined
      ? [insertRecord(db, owner, record)]
      : [
          updateRecord(db, owner, record, expectedVersion),
          ...assertChanged(db),
        ];
  try {
    await db.batch([
      ...statements,
      ...linkStatements(db, owner, record),
      ...applicationFileStatements(db, owner, [record]),
      ...additionalStatements,
    ]);
  } catch (error) {
    if (
      expectedVersion !== undefined &&
      String(error).includes("CHECK constraint failed")
    )
      throw new ApiError(
        409,
        "VERSION_CONFLICT",
        "This record changed in another session. Your draft has been preserved.",
        { record: await getRecord(db, owner, record.id, true) },
      );
    throw error;
  }
}
