import {
  BACKUP_MANIFEST_MAX_BYTES,
  BACKUP_MANIFEST_PATH,
  TAR_BLOCK_BYTES,
  backupStructureError,
  tarHeader,
  tarPadding,
  workBackupManifestSchema,
  type BackupRestoreResult,
  type WorkBackupManifest,
} from "../shared/backup";
import { ApiError, id, now, type Env } from "./env";
import { assertChanged, jsonChunks, type AttachmentRow } from "./db/records";
import { validateFile } from "./files";
import { checkIdempotency } from "./idempotency";
import {
  backupSchema,
  exportWorkspace,
  restoreWorkspace,
  validateRestoredRelations,
} from "./import-export";
import {
  hashValue,
  MAX_FILE_BYTES,
  parse,
  readLimitedBody,
} from "./validation";

interface RestorePlan {
  backup: ReturnType<typeof backupSchema.parse>;
  recordIds: Record<string, string>;
  attachmentIds: Record<string, string>;
}
interface RestoreSession {
  id: string;
  owner_id: string;
  manifest_hash: string;
  payload: string;
  expires_at: string;
  committed_at: string | null;
  response: string | null;
}
interface StagedFile {
  original_id: string;
  payload: string;
  checksum: string | null;
  uploaded_at: string | null;
}

function planKey(owner: string, restoreId: string) {
  return `${owner}/backup-staging/${restoreId}/plan`;
}
async function restorePlan(
  env: Env,
  current: RestoreSession,
): Promise<RestorePlan> {
  const key = planKey(current.owner_id, current.id);
  if ((JSON.parse(current.payload) as { objectKey?: string }).objectKey !== key)
    throw new ApiError(
      400,
      "INVALID_RESTORE_SESSION",
      "This restore session's metadata is invalid.",
    );
  const object = await env.FILES.get(key);
  if (!object)
    throw new ApiError(
      410,
      "RESTORE_EXPIRED",
      "This restore session's metadata is unavailable. Select the backup again to restart.",
    );
  return object.json<RestorePlan>();
}

function legacyManifest(manifest: WorkBackupManifest) {
  return parse(backupSchema, {
    ...manifest,
    format: "work-export",
    version: 2,
    attachments: manifest.attachments.map(({ path: _path, ...file }) => file),
  });
}

export async function downloadBackup(
  env: Env,
  owner: string,
): Promise<Response> {
  // Metadata is bounded; binary files are read from R2 one stream at a time.
  const backup = await exportWorkspace(env, owner, false);
  const rows = await env.DB.prepare(
    "SELECT * FROM attachments WHERE owner_id=? ORDER BY created_at",
  )
    .bind(owner)
    .all<AttachmentRow>();
  const indexed = new Map(rows.results.map((row) => [row.id, row]));
  const manifest: WorkBackupManifest = {
    ...backup,
    format: "work-backup",
    version: 3,
    goals: backup.goals ?? [],
    attachments: backup.attachments.map((file, index) => ({
      ...file,
      path: `attachments/${String(index).padStart(6, "0")}`,
    })),
  };
  const structureError = backupStructureError(manifest);
  if (structureError)
    throw new ApiError(
      409,
      "BACKUP_CHANGED",
      `${structureError} Please retry the backup download.`,
    );
  for (let start = 0; start < manifest.attachments.length; start += 8) {
    await Promise.all(
      manifest.attachments.slice(start, start + 8).map(async (file) => {
        const row = indexed.get(file.id);
        const object = row ? await env.FILES.head(row.object_key) : null;
        if (!object) file.missing = true;
        else if (object.size !== file.size)
          throw new ApiError(
            409,
            "BACKUP_FILE_CHANGED",
            "A file changed during backup. Please retry the download.",
          );
      }),
    );
  }
  const metadata = new TextEncoder().encode(JSON.stringify(manifest));
  if (metadata.length > BACKUP_MANIFEST_MAX_BYTES)
    throw new ApiError(
      413,
      "BACKUP_METADATA_TOO_LARGE",
      "The workspace metadata exceeds the 32 MB manifest limit.",
    );
  async function* archive(): AsyncGenerator<Uint8Array> {
    yield tarHeader(BACKUP_MANIFEST_PATH, metadata.length);
    yield metadata;
    if (tarPadding(metadata.length))
      yield new Uint8Array(tarPadding(metadata.length));
    for (const file of manifest.attachments) {
      if (file.missing) continue;
      const row = indexed.get(file.id)!;
      const object = await env.FILES.get(row.object_key);
      if (!object || object.size !== file.size)
        throw new Error(
          "A backup file became unavailable. Retry the download.",
        );
      yield tarHeader(file.path!, file.size);
      const reader = object.body.getReader();
      let received = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.byteLength;
          if (received > file.size)
            throw new Error("A backup file changed during download.");
          yield value;
        }
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
      if (received !== file.size)
        throw new Error("A backup file was truncated.");
      if (tarPadding(file.size)) yield new Uint8Array(tarPadding(file.size));
    }
    yield new Uint8Array(TAR_BLOCK_BYTES * 2);
  }
  const iterator = archive();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch (failure) {
        controller.error(failure);
      }
    },
    async cancel() {
      await iterator.return(undefined);
    },
  });
  const total =
    TAR_BLOCK_BYTES +
    metadata.length +
    tarPadding(metadata.length) +
    manifest.attachments
      .filter((file) => !file.missing)
      .reduce(
        (sum, file) =>
          sum + TAR_BLOCK_BYTES + file.size + tarPadding(file.size),
        0,
      ) +
    TAR_BLOCK_BYTES * 2;
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-tar",
      "Content-Length": String(total),
      "Content-Disposition": `attachment; filename="work-backup-${backup.exportedAt.slice(0, 10)}.tar"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function session(
  env: Env,
  owner: string,
  restoreId: string,
): Promise<RestoreSession> {
  const row = await env.DB.prepare(
    "SELECT * FROM backup_restore_sessions WHERE id=? AND owner_id=?",
  )
    .bind(restoreId, owner)
    .first<RestoreSession>();
  if (!row)
    throw new ApiError(
      404,
      "NOT_FOUND",
      "This backup restore session was not found.",
    );
  if (!row.committed_at && row.expires_at <= now())
    throw new ApiError(
      410,
      "RESTORE_EXPIRED",
      "This restore session expired. Select the backup again to restart.",
    );
  return row;
}

async function expireSessions(env: Env, owner: string) {
  const rows = await env.DB.prepare(
    "SELECT id FROM backup_restore_sessions WHERE owner_id=? AND committed_at IS NULL AND expires_at<=? LIMIT 5",
  )
    .bind(owner, now())
    .all<{ id: string }>();
  for (const row of rows.results)
    await cancelBackupRestore(env, owner, row.id, true);
}

export async function beginBackupRestore(
  env: Env,
  owner: string,
  input: unknown,
) {
  const value =
    input && typeof input === "object" && "manifest" in input
      ? input.manifest
      : undefined;
  const parsed = parse(workBackupManifestSchema, value);
  const backup = legacyManifest(parsed as WorkBackupManifest);
  const error = backupStructureError(backup);
  if (error) throw new ApiError(400, "INVALID_BACKUP", error);
  validateRestoredRelations(
    backup.records,
    backup.attachments.map((file) => ({
      id: file.id,
      owner_id: owner,
      record_id: file.recordId,
      object_key: "",
      filename: file.filename,
      content_type: file.contentType,
      size: file.size,
      created_at: file.createdAt,
    })),
    backup.goals,
  );
  await expireSessions(env, owner);
  const manifestHash = await hashValue(backup);
  const state = await checkIdempotency(
    env.DB,
    owner,
    `archive-restore:${manifestHash}`,
    backup,
  );
  if (state.response)
    return {
      restoreId: "",
      uploaded: [],
      committed: state.response as BackupRestoreResult,
    };
  let existing = await env.DB.prepare(
    "SELECT * FROM backup_restore_sessions WHERE owner_id=? AND manifest_hash=?",
  )
    .bind(owner, manifestHash)
    .first<RestoreSession>();
  if (!existing) {
    const restoreId = id();
    const recordIds = new Map(
      backup.records.map((record) => [record.id, id()]),
    );
    const fileRows = backup.attachments.map((file) => {
      const fileId = id();
      const recordId = recordIds.get(file.recordId)!;
      const row: AttachmentRow = {
        id: fileId,
        owner_id: owner,
        record_id: recordId,
        object_key: `${owner}/${recordId}/${fileId}`,
        filename: file.filename,
        content_type: file.contentType,
        size: file.size,
        created_at: file.createdAt,
      };
      return { original_id: file.id, payload: JSON.stringify(row) };
    });
    const plan: RestorePlan = {
      backup,
      recordIds: Object.fromEntries(recordIds),
      attachmentIds: Object.fromEntries(
        fileRows.map((file) => [
          file.original_id,
          (JSON.parse(file.payload) as AttachmentRow).id,
        ]),
      ),
    };
    const objectKey = planKey(owner, restoreId);
    await env.FILES.put(objectKey, JSON.stringify(plan), {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { owner, restoreId },
    });
    try {
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO backup_restore_sessions(id,owner_id,manifest_hash,payload,created_at,expires_at) VALUES(?,?,?,?,?,?)",
        ).bind(
          restoreId,
          owner,
          manifestHash,
          JSON.stringify({ objectKey }),
          now(),
          new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        ),
        ...jsonChunks(fileRows).map((chunk) =>
          env.DB.prepare(
            "INSERT INTO backup_restore_files(session_id,original_id,payload) SELECT ?,json_extract(value,'$.original_id'),json_extract(value,'$.payload') FROM json_each(?)",
          ).bind(restoreId, chunk),
        ),
      ]);
    } catch (failure) {
      await env.FILES.delete(objectKey);
      existing = await env.DB.prepare(
        "SELECT * FROM backup_restore_sessions WHERE owner_id=? AND manifest_hash=?",
      )
        .bind(owner, manifestHash)
        .first<RestoreSession>();
      if (!existing) throw failure;
    }
    existing ??= await session(env, owner, restoreId);
  }
  const uploaded = await env.DB.prepare(
    "SELECT original_id FROM backup_restore_files WHERE session_id=? AND uploaded_at IS NOT NULL",
  )
    .bind(existing.id)
    .all<{ original_id: string }>();
  return {
    restoreId: existing.id,
    uploaded: uploaded.results.map((file) => file.original_id),
    ...(existing.response
      ? { committed: JSON.parse(existing.response) as BackupRestoreResult }
      : {}),
  };
}

export async function stageBackupFile(
  env: Env,
  owner: string,
  restoreId: string,
  originalFileId: string,
  request: Request,
) {
  const current = await session(env, owner, restoreId);
  if (current.committed_at)
    throw new ApiError(
      409,
      "RESTORE_COMPLETE",
      "This backup was already restored.",
    );
  const plan = await restorePlan(env, current);
  const metadata = plan.backup.attachments.find(
    (file) => file.id === originalFileId,
  );
  const staged = await env.DB.prepare(
    "SELECT * FROM backup_restore_files WHERE session_id=? AND original_id=?",
  )
    .bind(restoreId, originalFileId)
    .first<StagedFile>();
  if (!metadata || !staged || metadata.missing)
    throw new ApiError(
      400,
      "INVALID_BACKUP_FILE",
      "Choose an available file listed in this restore session.",
    );
  const declaredType = request.headers
    .get("content-type")
    ?.split(";")[0]
    .trim();
  if (declaredType !== metadata.contentType)
    throw new ApiError(
      415,
      "FILE_TYPE_MISMATCH",
      "The upload format does not match the backup manifest.",
    );
  const bytes = await readLimitedBody(request, MAX_FILE_BYTES);
  if (bytes.length !== metadata.size)
    throw new ApiError(
      400,
      "FILE_SIZE_MISMATCH",
      "The uploaded file size does not match the backup manifest.",
    );
  validateFile(metadata.contentType, bytes);
  const checksum = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  if (staged.checksum && staged.checksum !== checksum)
    throw new ApiError(
      409,
      "RESTORE_FILE_CHANGED",
      "A different file was already staged for this attachment.",
    );
  const row = JSON.parse(staged.payload) as AttachmentRow;
  if (staged.uploaded_at && (await env.FILES.head(row.object_key)))
    return { uploaded: true };
  try {
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE backup_restore_files SET checksum=? WHERE session_id=? AND original_id=? AND (checksum IS NULL OR checksum=?)",
      ).bind(checksum, restoreId, originalFileId, checksum),
      ...assertChanged(env.DB),
    ]);
  } catch (failure) {
    if (String(failure).includes("CHECK constraint failed"))
      throw new ApiError(
        409,
        "RESTORE_FILE_CHANGED",
        "A different file was already staged for this attachment.",
      );
    throw failure;
  }
  await env.FILES.put(row.object_key, bytes, {
    httpMetadata: { contentType: row.content_type },
    customMetadata: { owner, recordId: row.record_id },
  });
  const marked = await env.DB.prepare(
    "UPDATE backup_restore_files SET uploaded_at=? WHERE session_id=? AND original_id=? AND checksum=?",
  )
    .bind(now(), restoreId, originalFileId, checksum)
    .run();
  if (!marked.meta.changes) {
    await env.FILES.delete(row.object_key);
    throw new ApiError(
      410,
      "RESTORE_CANCELLED",
      "This restore session was cancelled. Select the backup again to restart.",
    );
  }
  return { uploaded: true };
}

export async function commitBackupRestore(
  env: Env,
  owner: string,
  restoreId: string,
): Promise<BackupRestoreResult> {
  const current = await session(env, owner, restoreId);
  if (current.response)
    return JSON.parse(current.response) as BackupRestoreResult;
  const plan = await restorePlan(env, current);
  const staged = await env.DB.prepare(
    "SELECT * FROM backup_restore_files WHERE session_id=?",
  )
    .bind(restoreId)
    .all<StagedFile>();
  const files = new Map(staged.results.map((file) => [file.original_id, file]));
  for (const metadata of plan.backup.attachments) {
    if (metadata.missing) continue;
    const file = files.get(metadata.id);
    const row = file ? (JSON.parse(file.payload) as AttachmentRow) : undefined;
    if (
      !file?.uploaded_at ||
      !row ||
      (await env.FILES.head(row.object_key))?.size !== metadata.size
    )
      throw new ApiError(
        409,
        "RESTORE_FILES_PENDING",
        "Some files are still pending. Retry the restore to finish uploading them.",
      );
  }
  const result = await restoreWorkspace(env, owner, plan.backup, {
    recordIds: new Map(Object.entries(plan.recordIds)),
    attachmentIds: new Map(Object.entries(plan.attachmentIds)),
    attachments: staged.results.map(
      (file) => JSON.parse(file.payload) as AttachmentRow,
    ),
    idempotencyKey: `archive-restore:${current.manifest_hash}`,
    commitStatements: (response) => [
      env.DB.prepare(
        "UPDATE backup_restore_sessions SET committed_at=?,response=? WHERE id=? AND owner_id=? AND committed_at IS NULL",
      ).bind(
        now(),
        JSON.stringify({
          restored: response.restored,
          attachments: response.attachments,
          warnings: response.warnings,
        }),
        restoreId,
        owner,
      ),
      ...assertChanged(env.DB),
    ],
  });
  await env.FILES.delete(planKey(owner, restoreId)).catch(() => undefined);
  return result as BackupRestoreResult;
}

export async function cancelBackupRestore(
  env: Env,
  owner: string,
  restoreId: string,
  expired = false,
) {
  const current = expired
    ? await env.DB.prepare(
        "SELECT * FROM backup_restore_sessions WHERE id=? AND owner_id=?",
      )
        .bind(restoreId, owner)
        .first<RestoreSession>()
    : await session(env, owner, restoreId);
  if (!current)
    throw new ApiError(404, "NOT_FOUND", "This restore session was not found.");
  if (current.committed_at) return { cancelled: false, committed: true };
  const files = await env.DB.prepare(
    "SELECT payload FROM backup_restore_files WHERE session_id=?",
  )
    .bind(restoreId)
    .all<{ payload: string }>();
  const keys = [
    planKey(owner, restoreId),
    ...files.results.map(
      (file) => (JSON.parse(file.payload) as AttachmentRow).object_key,
    ),
  ];
  // Prevent cancellation racing an atomic commit from deleting committed files.
  const deleted = await env.DB.prepare(
    "DELETE FROM backup_restore_sessions WHERE id=? AND owner_id=? AND committed_at IS NULL",
  )
    .bind(restoreId, owner)
    .run();
  if (!deleted.meta.changes) return { cancelled: false, committed: true };
  for (let start = 0; start < keys.length; start += 1000)
    await env.FILES.delete(keys.slice(start, start + 1000));
  return { cancelled: true };
}

export async function cleanupOwnerBackupStaging(
  env: Env,
  owner: string,
): Promise<void> {
  const [files, sessions] = await Promise.all([
    env.DB.prepare(
      "SELECT f.payload FROM backup_restore_files f JOIN backup_restore_sessions s ON s.id=f.session_id WHERE s.owner_id=? AND s.committed_at IS NULL",
    )
      .bind(owner)
      .all<{ payload: string }>(),
    env.DB.prepare("SELECT id FROM backup_restore_sessions WHERE owner_id=?")
      .bind(owner)
      .all<{ id: string }>(),
  ]);
  await env.DB.prepare(
    "DELETE FROM backup_restore_sessions WHERE owner_id=? AND committed_at IS NULL",
  )
    .bind(owner)
    .run();
  const keys = [
    ...sessions.results.map((session) => planKey(owner, session.id)),
    ...files.results.map(
      (file) => (JSON.parse(file.payload) as AttachmentRow).object_key,
    ),
  ];
  for (let start = 0; start < keys.length; start += 1000)
    await env.FILES.delete(keys.slice(start, start + 1000));
}
