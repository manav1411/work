import { z } from "zod";
import {
  DEFAULT_PREFERENCES,
  type RecordRevision,
  type UserPreferences,
  type WorkRecord,
} from "../shared/model";
import { ApiError, type Env, id, now } from "./env";
import {
  applicationFileStatements,
  assertChanged,
  attachmentFromRow,
  bulkInsertRecords,
  bulkInsertLinks,
  bulkReplaceLinks,
  bulkUpdateRecords,
  dataReferences,
  fromRow,
  jsonChunks,
  newRecord,
  validateDataReferences,
  validateLinks,
  type AttachmentRow,
  type RecordRow,
} from "./db/records";
import {
  bulkInsertAttachments,
  fromBase64,
  prepareAttachment,
  toBase64,
} from "./files";
import {
  checkIdempotency,
  idempotencyStatement,
  raceResponse,
} from "./idempotency";
import {
  hashValue,
  importSchema,
  parse,
  preferencesSchema,
  recordSchema,
  type ImportPayload,
} from "./validation";

interface ImportSource {
  source: string;
  source_id: string;
  hash: string;
  record_id: string;
  batch_id: string;
}
interface ImportChange {
  record_id: string;
  before_record: string | null;
  before_source: string | null;
  after_version: number;
  attachments: string;
}
interface ImportItem {
  incoming: ImportPayload["records"][number];
  source: ImportSource | null;
  before: WorkRecord | null;
  record: WorkRecord;
  skip: boolean;
  hash: string;
}

function replaceAllLiteral(
  value: string,
  oldValue: string,
  newValue: string,
): string {
  return value.split(oldValue).join(newValue);
}
function remapReferenceFields(
  data: Record<string, unknown>,
  ids: Map<string, string>,
): Record<string, unknown> {
  const fields = new Set([
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
    "problemId",
    "topicId",
    "attachmentId",
    "primaryAttachmentId",
  ]);
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        if (fields.has(key) && typeof item === "string")
          return [key, ids.get(item) || item];
        if (
          Array.isArray(item) &&
          ["assetIds", "recordIds", "companyIds"].includes(key)
        )
          return [
            key,
            item.map((item) =>
              typeof item === "string" ? ids.get(item) || item : item,
            ),
          ];
        return [key, visit(item)];
      }),
    );
  };
  return visit(data) as Record<string, unknown>;
}

export async function importRecords(env: Env, owner: string, input: unknown) {
  const payload = parse(importSchema, input);
  if (
    payload.records.reduce((sum, item) => sum + item.attachments.length, 0) > 40
  )
    throw new ApiError(
      413,
      "IMPORT_TOO_MANY_FILES",
      "Split imports containing more than 40 attachments into smaller batches.",
    );
  if (
    new Set(payload.records.map((item) => item.sourceId)).size !==
    payload.records.length
  )
    throw new ApiError(
      400,
      "DUPLICATE_SOURCE",
      "Each imported record needs a unique source identifier.",
    );
  const state = await checkIdempotency(
    env.DB,
    owner,
    payload.idempotencyKey,
    payload,
  );
  if (state.response) return state.response;
  const sourceRows = await env.DB.prepare(
    "SELECT * FROM import_sources WHERE owner_id=? AND source=?",
  )
    .bind(owner, payload.source)
    .all<ImportSource>();
  const sources = new Map(
    sourceRows.results.map((source) => [source.source_id, source]),
  );
  const existingRows = await env.DB.prepare(
    "SELECT * FROM records WHERE owner_id=?",
  )
    .bind(owner)
    .all<RecordRow>();
  const existing = new Map(
    existingRows.results.map((row) => [row.id, fromRow(row)]),
  );
  const items: ImportItem[] = [];
  const warnings: string[] = [];
  for (const incoming of payload.records) {
    const source = sources.get(incoming.sourceId) || null;
    const before = source ? existing.get(source.record_id) || null : null;
    const hash = await hashValue({
      record: incoming.record,
      attachments: incoming.attachments,
    });
    const skip = Boolean(
      source && before && (source.hash === hash || payload.mode === "keep"),
    );
    if (skip && source?.hash !== hash)
      warnings.push(
        `Kept your existing copy of ${incoming.record.title}; the source changed. Choose replace or merge to update it.`,
      );
    if (before && before.kind !== incoming.record.kind)
      throw new ApiError(
        400,
        "IMPORT_KIND_CHANGED",
        `The source type changed for ${incoming.record.title}. Use a separate source identifier.`,
      );
    const record = before
      ? {
          ...before,
          ...incoming.record,
          body:
            payload.mode === "merge" && before.body !== incoming.record.body
              ? `${before.body}\n\n---\n\n${incoming.record.body}`
              : incoming.record.body,
          tags:
            payload.mode === "merge"
              ? [...new Set([...before.tags, ...incoming.record.tags])]
              : incoming.record.tags,
          links:
            payload.mode === "merge"
              ? [...new Set([...before.links, ...incoming.record.links])]
              : incoming.record.links,
          data:
            payload.mode === "merge"
              ? { ...before.data, ...incoming.record.data }
              : incoming.record.data,
          version: before.version + 1,
          updatedAt: now(),
          deletedAt: null,
        }
      : newRecord(incoming.record);
    items.push({ incoming, source, before, record, skip, hash });
  }
  const sourceIds = new Map(
    items.map((item) => [
      item.incoming.sourceId,
      item.skip ? item.before!.id : item.record.id,
    ]),
  );
  // References to sources kept from an earlier import also resolve correctly.
  for (const source of sources.values())
    if (!sourceIds.has(source.source_id))
      sourceIds.set(source.source_id, source.record_id);
  const allowed = new Set(
    items.filter((item) => !item.skip).map((item) => item.record.id),
  );
  const batchId = id();
  const attachments: AttachmentRow[] = [];
  const changeRows: (ImportChange & { batch_id: string })[] = [];
  const changedItems = items.filter((item) => !item.skip);
  for (const item of changedItems)
    item.record.links = [
      ...new Set(item.record.links.map((link) => sourceIds.get(link) || link)),
    ];
  await validateLinks(
    env.DB,
    owner,
    [...new Set(changedItems.flatMap((item) => item.record.links))],
    allowed,
  );
  try {
    for (const item of changedItems) {
      for (const [sourceId, recordId] of sourceIds) {
        item.record.body = replaceAllLiteral(
          item.record.body,
          `work-source://${encodeURIComponent(sourceId)}`,
          `/notes?record=${encodeURIComponent(recordId)}`,
        );
      }
      const ownAttachments: AttachmentRow[] = [];
      for (const file of item.incoming.attachments) {
        const row = await prepareAttachment(
          env,
          owner,
          item.record.id,
          file.filename,
          file.contentType,
          fromBase64(file.base64),
        );
        attachments.push(row);
        ownAttachments.push(row);
        item.record.body = replaceAllLiteral(
          item.record.body,
          `work-attachment://${encodeURIComponent(file.filename)}`,
          `/api/attachments/${row.id}`,
        );
      }
      const primaryPdf = ownAttachments.find(
        (file) => file.content_type === "application/pdf",
      );
      if (
        item.record.kind === "asset" &&
        primaryPdf &&
        !item.record.data.primaryAttachmentId
      ) {
        item.record.data = {
          ...item.record.data,
          primaryAttachmentId: primaryPdf.id,
          primaryAttachmentName: primaryPdf.filename,
        };
      }
      item.record.data = {
        ...item.record.data,
        import: {
          source: payload.source,
          sourceId: item.incoming.sourceId,
          sourceHash: item.incoming.hash,
          contentHash: item.hash,
          importedAt: now(),
          batchId,
        },
      };
      item.record.data = remapReferenceFields(item.record.data, sourceIds);
      changeRows.push({
        batch_id: batchId,
        record_id: item.record.id,
        before_record: item.before ? JSON.stringify(item.before) : null,
        before_source: item.source ? JSON.stringify(item.source) : null,
        after_version: item.record.version,
        attachments: JSON.stringify(ownAttachments.map((row) => row.id)),
      });
    }
    const created = items.filter((item) => !item.skip && !item.before).length;
    const updated = items.filter((item) => !item.skip && item.before).length;
    const skipped = items.filter((item) => item.skip).length;
    const response = {
      batchId,
      created,
      updated,
      skipped,
      warnings,
      records: items.map((item) => (item.skip ? item.before! : item.record)),
    };
    const retainedReferences = changedItems
      .filter((item) => item.before)
      .map((item) => dataReferences(item.before!.data));
    await validateDataReferences(
      env.DB,
      owner,
      { batch: changedItems.map((item) => item.record.data) },
      new Set([
        ...allowed,
        ...retainedReferences.flatMap((refs) => refs.records),
      ]),
      new Set([
        ...attachments.map((file) => file.id),
        ...retainedReferences.flatMap((refs) => refs.files),
      ]),
    );
    const batchStatement = env.DB.prepare(
      "INSERT INTO import_batches(id,owner_id,source,created_at,created_count,updated_count,skipped_count) VALUES(?,?,?,?,?,?,?)",
    ).bind(batchId, owner, payload.source, now(), created, updated, skipped);
    // All inserts run before relationship inserts, allowing circular links in a batch.
    const writes = [
      batchStatement,
      ...bulkInsertRecords(
        env.DB,
        owner,
        changedItems.filter((item) => !item.before).map((item) => item.record),
      ),
      ...bulkUpdateRecords(
        env.DB,
        owner,
        changedItems
          .filter((item) => item.before)
          .map((item) => ({
            record: item.record,
            expectedVersion: item.before!.version,
          })),
      ),
      ...jsonChunks(changeRows).map((chunk) =>
        env.DB.prepare(
          "INSERT INTO import_changes(batch_id,record_id,before_record,before_source,after_version,attachments) SELECT json_extract(value,'$.batch_id'),json_extract(value,'$.record_id'),json_extract(value,'$.before_record'),json_extract(value,'$.before_source'),json_extract(value,'$.after_version'),json_extract(value,'$.attachments') FROM json_each(?)",
        ).bind(chunk),
      ),
      ...jsonChunks(
        changedItems.map((item) => ({
          source_id: item.incoming.sourceId,
          hash: item.hash,
          record_id: item.record.id,
        })),
      ).map((chunk) =>
        env.DB.prepare(
          "INSERT INTO import_sources(owner_id,source,source_id,hash,record_id,batch_id) SELECT ?,?,json_extract(value,'$.source_id'),json_extract(value,'$.hash'),json_extract(value,'$.record_id'),? FROM json_each(?) WHERE true ON CONFLICT(owner_id,source,source_id) DO UPDATE SET hash=excluded.hash,record_id=excluded.record_id,batch_id=excluded.batch_id",
        ).bind(owner, payload.source, batchId, chunk),
      ),
      ...bulkReplaceLinks(
        env.DB,
        owner,
        changedItems.filter((item) => item.before).map((item) => item.record),
      ),
      ...bulkInsertLinks(
        env.DB,
        owner,
        changedItems.filter((item) => !item.before).map((item) => item.record),
      ),
      ...bulkInsertAttachments(env.DB, attachments),
      ...applicationFileStatements(
        env.DB,
        owner,
        changedItems.map((item) => item.record),
      ),
      ...idempotencyStatement(env.DB, owner, state, response),
    ];
    if (writes.length > 35)
      throw new ApiError(
        413,
        "IMPORT_TOO_LARGE",
        "Split this import into smaller batches of records and attachments.",
      );
    await env.DB.batch(writes);
    return response;
  } catch (error) {
    if (attachments.length)
      await env.FILES.delete(attachments.map((row) => row.object_key));
    const response = await raceResponse(env.DB, owner, state);
    if (response) return response;
    if (String(error).includes("CHECK constraint failed"))
      throw new ApiError(
        409,
        "IMPORT_CONFLICT",
        "Some records changed during import. Preview and retry the batch.",
      );
    throw error;
  }
}

export async function undoImport(env: Env, owner: string, batchId: string) {
  const batch = await env.DB.prepare(
    "SELECT * FROM import_batches WHERE id=? AND owner_id=?",
  )
    .bind(batchId, owner)
    .first<{ source: string; undone_at: string | null }>();
  if (!batch)
    throw new ApiError(404, "NOT_FOUND", "This import batch was not found.");
  if (batch.undone_at) return { undone: true, alreadyUndone: true };
  const changes = await env.DB.prepare(
    "SELECT * FROM import_changes WHERE batch_id=?",
  )
    .bind(batchId)
    .all<ImportChange>();
  const rows = await env.DB.prepare("SELECT * FROM records WHERE owner_id=?")
    .bind(owner)
    .all<RecordRow>();
  const records = new Map(rows.results.map((row) => [row.id, fromRow(row)]));
  const updates: { record: WorkRecord; expectedVersion: number }[] = [];
  const sourceRows: ImportSource[] = [];
  const attachmentIds: string[] = [];
  for (const change of changes.results) {
    const current = records.get(change.record_id);
    if (!current || current.version !== change.after_version)
      throw new ApiError(
        409,
        "IMPORT_UNDO_CONFLICT",
        "A record from this import was edited afterwards. Export or review those edits before undoing the batch.",
      );
    const restored: WorkRecord = change.before_record
      ? {
          ...JSON.parse(change.before_record),
          version: current.version + 1,
          updatedAt: now(),
        }
      : {
          ...current,
          deletedAt: now(),
          updatedAt: now(),
          version: current.version + 1,
        };
    updates.push({ record: restored, expectedVersion: current.version });
    if (change.before_source) sourceRows.push(JSON.parse(change.before_source));
    // Creations remain in recoverable trash with their files. Only replacement
    // files are removed when reverting an earlier record snapshot.
    if (change.before_record)
      attachmentIds.push(...(JSON.parse(change.attachments) as string[]));
  }
  const removeAttachments = attachmentIds.length
    ? (
        await env.DB.prepare(
          "SELECT object_key FROM attachments WHERE owner_id=? AND id IN (SELECT value FROM json_each(?))",
        )
          .bind(owner, JSON.stringify(attachmentIds))
          .all<{ object_key: string }>()
      ).results.map((row) => row.object_key)
    : [];
  const statements = [
    ...bulkUpdateRecords(env.DB, owner, updates),
    ...bulkReplaceLinks(
      env.DB,
      owner,
      updates.map((item) => item.record),
    ),
    ...applicationFileStatements(
      env.DB,
      owner,
      updates.map((item) => item.record),
    ),
    env.DB.prepare(
      "DELETE FROM import_sources WHERE owner_id=? AND source=? AND batch_id=?",
    ).bind(owner, batch.source, batchId),
    ...jsonChunks(sourceRows).map((chunk) =>
      env.DB.prepare(
        "INSERT INTO import_sources(owner_id,source,source_id,hash,record_id,batch_id) SELECT ?,json_extract(value,'$.source'),json_extract(value,'$.source_id'),json_extract(value,'$.hash'),json_extract(value,'$.record_id'),json_extract(value,'$.batch_id') FROM json_each(?)",
      ).bind(owner, chunk),
    ),
    ...(attachmentIds.length
      ? [
          env.DB.prepare(
            "DELETE FROM attachments WHERE owner_id=? AND id IN (SELECT value FROM json_each(?))",
          ).bind(owner, JSON.stringify(attachmentIds)),
        ]
      : []),
  ];
  statements.push(
    env.DB.prepare(
      "UPDATE import_batches SET undone_at=? WHERE id=? AND owner_id=? AND undone_at IS NULL",
    ).bind(now(), batchId, owner),
    ...assertChanged(env.DB),
  );
  try {
    await env.DB.batch(statements);
  } catch (error) {
    if (String(error).includes("CHECK constraint failed"))
      throw new ApiError(
        409,
        "IMPORT_UNDO_CONFLICT",
        "The imported data changed while undo was running. Nothing was undone.",
      );
    if (String(error).includes("FOREIGN KEY constraint failed"))
      throw new ApiError(
        409,
        "IMPORT_UNDO_FILE_IN_USE",
        "An imported file was captured in an application. Remove that captured version before undoing its replacement.",
      );
    throw error;
  }
  if (removeAttachments.length) await env.FILES.delete(removeAttachments);
  return { undone: true, records: changes.results.length };
}

interface ExportAttachment {
  id: string;
  recordId: string;
  filename: string;
  contentType: string;
  size: number;
  createdAt: string;
  base64?: string;
  missing?: boolean;
}
export interface WorkspaceExport {
  format: "work-export";
  version: 1;
  exportedAt: string;
  records: WorkRecord[];
  preferences: UserPreferences;
  attachments: ExportAttachment[];
  revisions: RecordRevision[];
}

export async function exportWorkspace(
  env: Env,
  owner: string,
  includeFiles = true,
): Promise<WorkspaceExport> {
  const [rows, preferences, files, revisionRows] = await Promise.all([
    env.DB.prepare("SELECT * FROM records WHERE owner_id=? ORDER BY created_at")
      .bind(owner)
      .all<RecordRow>(),
    env.DB.prepare("SELECT data FROM preferences WHERE owner_id=?")
      .bind(owner)
      .first<{ data: string }>(),
    env.DB.prepare(
      "SELECT * FROM attachments WHERE owner_id=? ORDER BY created_at",
    )
      .bind(owner)
      .all<AttachmentRow>(),
    env.DB.prepare(
      "SELECT * FROM record_revisions WHERE owner_id=? ORDER BY record_id,version",
    )
      .bind(owner)
      .all<{
        id: string;
        record_id: string;
        version: number;
        title: string;
        body: string;
        tags: string;
        links: string;
        data: string;
        created_at: string;
      }>(),
  ]);
  // Export is bounded to keep the Worker memory footprint predictable.
  if (
    includeFiles &&
    files.results.reduce((sum, file) => sum + file.size, 0) > 20 * 1024 * 1024
  )
    throw new ApiError(
      413,
      "EXPORT_TOO_LARGE",
      "The files exceed the 20 MB bundled export limit. Download large attachments separately or export without files.",
      { retryUrl: "/api/export?files=false" },
    );
  const attachments: ExportAttachment[] = [];
  for (const row of files.results) {
    const object = includeFiles ? await env.FILES.get(row.object_key) : null;
    attachments.push({
      ...attachmentFromRow(row),
      ...(object
        ? { base64: toBase64(new Uint8Array(await object.arrayBuffer())) }
        : includeFiles
          ? { missing: true }
          : {}),
    });
  }
  return {
    format: "work-export",
    version: 1,
    exportedAt: now(),
    records: rows.results.map(fromRow),
    preferences: preferences
      ? { ...DEFAULT_PREFERENCES, ...JSON.parse(preferences.data) }
      : { ...DEFAULT_PREFERENCES },
    attachments,
    revisions: revisionRows.results.map((row) => ({
      id: row.id,
      recordId: row.record_id,
      version: row.version,
      title: row.title,
      body: row.body,
      tags: JSON.parse(row.tags),
      links: JSON.parse(row.links),
      data: JSON.parse(row.data),
      createdAt: row.created_at,
    })),
  };
}

const backupRecordSchema = recordSchema.extend({
  id: z.string().min(1).max(120),
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});
const backupSchema = z
  .object({
    format: z.literal("work-export"),
    version: z.literal(1),
    exportedAt: z.string().datetime(),
    records: z.array(backupRecordSchema).max(5000),
    preferences: preferencesSchema,
    attachments: z
      .array(
        z
          .object({
            id: z.string().min(1).max(120),
            recordId: z.string().min(1).max(120),
            filename: z.string().min(1).max(240),
            contentType: z.string().max(100),
            size: z.number().int().min(0),
            createdAt: z.string().datetime(),
            base64: z.string().max(14_000_000).optional(),
            missing: z.boolean().optional(),
          })
          .strict(),
      )
      .max(5000),
    revisions: z
      .array(
        z
          .object({
            id: z.string().max(250),
            recordId: z.string().max(120),
            version: z.number().int().positive(),
            title: z.string().max(240),
            body: z.string().max(500_000),
            tags: z.array(z.string()),
            links: z.array(z.string()),
            data: z.record(z.string(), z.unknown()),
            createdAt: z.string().datetime(),
          })
          .strict(),
      )
      .max(50_000)
      .default([]),
  })
  .strict();

export async function restoreWorkspace(
  env: Env,
  owner: string,
  input: unknown,
) {
  const backup = parse(backupSchema, input);
  if (backup.attachments.length > 40)
    throw new ApiError(
      413,
      "RESTORE_TOO_MANY_FILES",
      "Split backups containing more than 40 attachments into smaller linked archives.",
    );
  const ids = new Map(backup.records.map((record) => [record.id, id()]));
  if (ids.size !== backup.records.length)
    throw new ApiError(
      400,
      "INVALID_BACKUP",
      "The backup contains duplicate record IDs.",
    );
  for (const record of backup.records)
    if (record.links.some((link) => !ids.has(link)))
      throw new ApiError(
        400,
        "INVALID_BACKUP",
        "The backup contains a link to a missing record.",
      );
  const key = `restore:${await hashValue(backup)}`;
  const state = await checkIdempotency(env.DB, owner, key, backup);
  if (state.response) return state.response;
  const attachments: AttachmentRow[] = [];
  const attachmentIds = new Map<string, string>();
  const warnings: string[] = [];
  try {
    for (const file of backup.attachments) {
      const recordId = ids.get(file.recordId);
      if (!recordId)
        throw new ApiError(
          400,
          "INVALID_BACKUP",
          "An attachment references a missing record.",
        );
      if (!file.base64) {
        warnings.push(
          `Attachment ${file.filename} has no file content in this backup. Its metadata is retained.`,
        );
        const attachmentId = id();
        attachments.push({
          id: attachmentId,
          owner_id: owner,
          record_id: recordId,
          object_key: `${owner}/${recordId}/${attachmentId}`,
          filename: file.filename,
          content_type: file.contentType,
          size: file.size,
          created_at: file.createdAt,
        });
        attachmentIds.set(file.id, attachmentId);
        continue;
      }
      const bytes = fromBase64(file.base64);
      if (bytes.length !== file.size)
        throw new ApiError(
          400,
          "INVALID_BACKUP",
          "An attachment size does not match the backup metadata.",
        );
      const row = await prepareAttachment(
        env,
        owner,
        recordId,
        file.filename,
        file.contentType,
        bytes,
      );
      attachments.push(row);
      attachmentIds.set(file.id, row.id);
    }
    const rewriteBody = (body: string) => {
      for (const [oldId, newId] of ids)
        body = replaceAllLiteral(
          body,
          `record=${encodeURIComponent(oldId)}`,
          `record=${encodeURIComponent(newId)}`,
        );
      for (const [oldId, newId] of attachmentIds)
        body = replaceAllLiteral(
          body,
          `/api/attachments/${oldId}`,
          `/api/attachments/${newId}`,
        );
      return body;
    };
    const rewriteData = (data: Record<string, unknown>) => {
      // Exact record-ID values in structured relation fields follow the restore.
      const visit = (value: unknown): unknown => {
        if (typeof value === "string")
          return (
            ids.get(value) || attachmentIds.get(value) || rewriteBody(value)
          );
        if (Array.isArray(value)) return value.map(visit);
        if (value && typeof value === "object")
          return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [key, visit(item)]),
          );
        return value;
      };
      return visit(data) as Record<string, unknown>;
    };
    const records: WorkRecord[] = backup.records.map((record) => ({
      ...record,
      id: ids.get(record.id)!,
      links: record.links.map((link) => ids.get(link)!),
      body: rewriteBody(record.body),
      data: rewriteData(record.data),
    }));
    await validateDataReferences(
      env.DB,
      owner,
      { batch: records.map((record) => record.data) },
      new Set(ids.values()),
      new Set(attachmentIds.values()),
    );
    const statements = bulkInsertRecords(env.DB, owner, records);
    statements.push(
      ...bulkInsertLinks(env.DB, owner, records),
      ...bulkInsertAttachments(env.DB, attachments),
    );
    statements.push(...applicationFileStatements(env.DB, owner, records));
    const revisionInserts: Record<string, unknown>[] = [];
    for (const revision of backup.revisions) {
      const recordId = ids.get(revision.recordId);
      if (!recordId)
        throw new ApiError(
          400,
          "INVALID_BACKUP",
          "A revision references a missing record.",
        );
      const record = records.find((item) => item.id === recordId)!;
      if (revision.version >= record.version) continue; // Current revision was created by the record trigger.
      revisionInserts.push({
        id: `${recordId}:${revision.version}`,
        record_id: recordId,
        version: revision.version,
        title: revision.title,
        body: rewriteBody(revision.body),
        tags: revision.tags,
        links: revision.links.map((link) => ids.get(link) || link),
        data: rewriteData(revision.data),
        created_at: revision.createdAt,
      });
    }
    statements.push(
      ...jsonChunks(revisionInserts).map((chunk) =>
        env.DB.prepare(
          "INSERT INTO record_revisions(id,record_id,owner_id,version,title,body,tags,links,data,created_at) SELECT json_extract(value,'$.id'),json_extract(value,'$.record_id'),?,json_extract(value,'$.version'),json_extract(value,'$.title'),json_extract(value,'$.body'),json_extract(value,'$.tags'),json_extract(value,'$.links'),json_extract(value,'$.data'),json_extract(value,'$.created_at') FROM json_each(?)",
        ).bind(owner, chunk),
      ),
    );
    statements.push(
      env.DB.prepare(
        "INSERT INTO preferences(owner_id,data,updated_at) VALUES(?,?,?) ON CONFLICT(owner_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at",
      ).bind(owner, JSON.stringify(backup.preferences), now()),
    );
    const response = {
      restored: records.length,
      attachments: attachments.length,
      warnings,
      records,
    };
    statements.push(...idempotencyStatement(env.DB, owner, state, response));
    if (statements.length > 35)
      throw new ApiError(
        413,
        "RESTORE_TOO_LARGE",
        "This backup exceeds the atomic restore limit. Split the archive into smaller linked groups before restoring.",
      );
    await env.DB.batch(statements);
    return response;
  } catch (error) {
    if (attachments.length)
      await env.FILES.delete(attachments.map((row) => row.object_key));
    const response = await raceResponse(env.DB, owner, state);
    if (response) return response;
    throw error;
  }
}
