import {
  MANIFEST_MAX_BYTES,
  MANIFEST_PATH,
  TAR_BLOCK_BYTES,
  workspaceManifestSchema,
  workspacePackageError,
  remapWorkspace,
  tarHeader,
  tarPadding,
  type WorkspaceManifest,
} from "../shared/transfer";
import { DEFAULT_PREFERENCES } from "../shared/model";
import { latexSourceSchema, latexInputHash } from "../shared/latex";
import { ApiError, id, now, type Env } from "./env";
import {
  fromRow,
  attachmentFromRow,
  bulkInsertRecords,
  bulkInsertLinks,
  jsonChunks,
  type RecordRow,
  type AttachmentRow,
} from "./db/records";
import { bulkInsertAttachments, validateFile } from "./files";
import { listGoals, bulkInsertGoals } from "./goals";
import {
  parse,
  preferencesSchema,
  readLimitedBody,
  hashValue,
} from "./validation";

interface State {
  epoch: string;
  generation: number;
}
interface Upload extends State {
  id: string;
  owner_id: string;
  expires_at: string;
  committed_at: string | null;
  response: string | null;
}
interface Plan {
  manifest: WorkspaceManifest;
  originalFiles: WorkspaceManifest["attachments"];
  files: AttachmentRow[];
}
export async function workspaceState(env: Env, owner: string): Promise<State> {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO workspace_state(owner_id) VALUES(?)",
  )
    .bind(owner)
    .run();
  return (await env.DB.prepare(
    "SELECT epoch,generation FROM workspace_state WHERE owner_id=?",
  )
    .bind(owner)
    .first<State>())!;
}
function planKey(owner: string, uploadId: string) {
  return `${owner}/workspace-upload/${uploadId}/manifest`;
}
async function upload(
  env: Env,
  owner: string,
  uploadId: string,
): Promise<Upload> {
  const row = await env.DB.prepare(
    "SELECT * FROM workspace_uploads WHERE id=? AND owner_id=?",
  )
    .bind(uploadId, owner)
    .first<Upload>();
  if (!row) throw new ApiError(404, "NOT_FOUND", "This upload was not found.");
  if (!row.committed_at && row.expires_at <= now())
    throw new ApiError(
      410,
      "UPLOAD_EXPIRED",
      "This upload expired. Select the file again.",
    );
  return row;
}
async function plan(env: Env, row: Upload): Promise<Plan> {
  const object = await env.FILES.get(planKey(row.owner_id, row.id));
  if (!object)
    throw new ApiError(
      410,
      "UPLOAD_EXPIRED",
      "Select the workspace export again.",
    );
  return object.json<Plan>();
}
export async function exportWorkspace(
  env: Env,
  owner: string,
): Promise<Response> {
  const state = await workspaceState(env, owner);
  const [recordRows, fileRows, prefs, goals] = await Promise.all([
    env.DB.prepare(
      "SELECT * FROM records WHERE owner_id=? ORDER BY created_at,id",
    )
      .bind(owner)
      .all<RecordRow>(),
    env.DB.prepare(
      "SELECT * FROM attachments WHERE owner_id=? ORDER BY created_at,id",
    )
      .bind(owner)
      .all<AttachmentRow>(),
    env.DB.prepare("SELECT data FROM preferences WHERE owner_id=?")
      .bind(owner)
      .first<{ data: string }>(),
    listGoals(env.DB, owner),
  ]);
  const manifest: WorkspaceManifest = {
    format: "work-workspace",
    version: 1,
    exportedAt: now(),
    records: recordRows.results.map(fromRow),
    goals,
    preferences: prefs
      ? parse(preferencesSchema, JSON.parse(prefs.data))
      : { ...DEFAULT_PREFERENCES },
    attachments: fileRows.results.map((row, index) => ({
      ...attachmentFromRow(row),
      path: `files/${String(index).padStart(6, "0")}`,
    })),
  };
  parse(workspaceManifestSchema, manifest);
  const error = workspacePackageError(manifest);
  if (error) throw new ApiError(409, "WORKSPACE_CHANGED", error);
  for (const file of fileRows.results)
    if ((await env.FILES.head(file.object_key))?.size !== file.size)
      throw new ApiError(
        409,
        "FILE_MISSING",
        "A current file is unavailable. Retry after fixing the document.",
      );
  if ((await workspaceState(env, owner)).generation !== state.generation)
    throw new ApiError(
      409,
      "WORKSPACE_CHANGED",
      "The workspace changed during export. Retry.",
    );
  const metadata = new TextEncoder().encode(JSON.stringify(manifest));
  if (metadata.length > MANIFEST_MAX_BYTES)
    throw new ApiError(
      413,
      "EXPORT_TOO_LARGE",
      "Workspace metadata exceeds 32 MB.",
    );
  async function* archive(): AsyncGenerator<Uint8Array> {
    yield tarHeader(MANIFEST_PATH, metadata.length);
    yield metadata;
    if (tarPadding(metadata.length))
      yield new Uint8Array(tarPadding(metadata.length));
    for (let index = 0; index < fileRows.results.length; index++) {
      const file = fileRows.results[index],
        object = await env.FILES.get(file.object_key);
      if (!object || object.size !== file.size)
        throw new Error("A current file changed during export. Retry.");
      yield tarHeader(manifest.attachments[index].path, file.size);
      const reader = object.body.getReader();
      let received = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.byteLength;
          if (received > file.size) throw new Error("File changed.");
          yield value;
        }
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
      if (received !== file.size) throw new Error("File truncated.");
      if (tarPadding(file.size)) yield new Uint8Array(tarPadding(file.size));
    }
    yield new Uint8Array(TAR_BLOCK_BYTES * 2);
  }
  const iterator = archive();
  return new Response(
    new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await iterator.next();
          if (next.done) controller.close();
          else controller.enqueue(next.value);
        } catch (error) {
          controller.error(error);
        }
      },
      async cancel() {
        await iterator.return(undefined);
      },
    }),
    {
      headers: {
        "Content-Type": "application/x-tar",
        "Content-Disposition": `attachment; filename="work-workspace-${manifest.exportedAt.slice(0, 10)}.tar"`,
      },
    },
  );
}
export async function beginWorkspaceUpload(
  env: Env,
  owner: string,
  input: unknown,
) {
  const original = parse(
    workspaceManifestSchema,
    input,
  ) as unknown as WorkspaceManifest;
  original.preferences = parse(preferencesSchema, original.preferences);
  const error = workspacePackageError(original);
  if (error) throw new ApiError(400, "INVALID_WORKSPACE", error);
  const state = await workspaceState(env, owner),
    uploadId = id();
  const ids = new Map(
    [...original.records, ...original.goals, ...original.attachments].map(
      (item) => [item.id, id()],
    ),
  );
  const manifest = remapWorkspace(original, ids);
  const files = manifest.attachments.map((file) => ({
    id: file.id,
    owner_id: owner,
    record_id: file.recordId,
    object_key: `${owner}/workspace-upload/${uploadId}/${file.id}`,
    filename: file.filename,
    content_type: file.contentType,
    size: file.size,
    created_at: file.createdAt,
  }));
  const pending: Plan = {
    manifest,
    originalFiles: original.attachments,
    files,
  };
  await env.FILES.put(planKey(owner, uploadId), JSON.stringify(pending));
  try {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO workspace_uploads(id,owner_id,epoch,generation,expires_at) VALUES(?,?,?,?,?)",
      ).bind(
        uploadId,
        owner,
        state.epoch,
        state.generation,
        new Date(Date.now() + 3600_000).toISOString(),
      ),
      ...jsonChunks(
        files.map((file, index) => ({
          originalId: original.attachments[index].id,
          payload: JSON.stringify(file),
        })),
      ).map((chunk) =>
        env.DB.prepare(
          "INSERT INTO workspace_upload_files(upload_id,original_id,payload) SELECT ?,json_extract(value,'$.originalId'),json_extract(value,'$.payload') FROM json_each(?)",
        ).bind(uploadId, chunk),
      ),
    ]);
  } catch (error) {
    await env.FILES.delete(planKey(owner, uploadId));
    throw error;
  }
  return { uploadId };
}
export async function stageWorkspaceFile(
  env: Env,
  owner: string,
  uploadId: string,
  originalId: string,
  request: Request,
) {
  const current = await upload(env, owner, uploadId);
  if (current.committed_at)
    throw new ApiError(
      409,
      "UPLOAD_COMPLETE",
      "This workspace was already uploaded.",
    );
  const pending = await plan(env, current);
  const index = pending.originalFiles.findIndex(
    (file) => file.id === originalId,
  );
  if (index < 0)
    throw new ApiError(
      404,
      "NOT_FOUND",
      "This file is absent from the workspace package.",
    );
  const file = pending.files[index],
    bytes = await readLimitedBody(request, 10 * 1024 * 1024);
  if (bytes.length !== file.size)
    throw new ApiError(
      400,
      "FILE_SIZE",
      "The uploaded file does not match its metadata.",
    );
  validateFile(file.content_type, bytes);
  const sourceRecord = pending.manifest.records.find(
    (record) =>
      (record.data.latexProject as { sourceId?: string } | undefined)
        ?.sourceId === file.id,
  );
  const activeSource =
    sourceRecord ||
    pending.manifest.records.some(
      (record) =>
        Array.isArray(record.data.latexJobs) &&
        record.data.latexJobs.some(
          (job) => (job as { sourceId?: string }).sourceId === file.id,
        ),
    );
  if (activeSource) {
    try {
      const source = parse(
        latexSourceSchema,
        JSON.parse(new TextDecoder().decode(bytes)),
      );
      if (sourceRecord) {
        const metadata = sourceRecord.data.latexProject as {
          mainFile: string;
          engine: string;
          inputHash: string;
        };
        if (
          metadata.mainFile !== source.mainFile ||
          metadata.engine !== source.engine ||
          metadata.inputHash !== (await latexInputHash(source))
        )
          throw new Error("Source metadata mismatch");
      }
    } catch {
      throw new ApiError(
        400,
        "INVALID_SOURCE",
        "This document source is invalid.",
      );
    }
  }
  const checksum = await hashValue(
    Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", bytes.buffer as ArrayBuffer),
      ),
    ),
  );
  const stagedFile = { ...file, object_key: `${file.object_key}/${checksum}` };
  const saved = await env.DB.prepare(
    "SELECT checksum FROM workspace_upload_files WHERE upload_id=? AND original_id=?",
  )
    .bind(uploadId, originalId)
    .first<{ checksum: string | null }>();
  if (saved?.checksum && saved.checksum !== checksum)
    throw new ApiError(
      409,
      "FILE_CHANGED",
      "A different file was already uploaded.",
    );
  await env.FILES.put(stagedFile.object_key, bytes, {
    httpMetadata: { contentType: file.content_type },
    customMetadata: { owner, recordId: file.record_id },
  });
  const result = await env.DB.prepare(
    "UPDATE workspace_upload_files SET checksum=?,uploaded_at=?,payload=? WHERE upload_id=? AND original_id=? AND EXISTS(SELECT 1 FROM workspace_uploads WHERE id=? AND committed_at IS NULL) AND (checksum IS NULL OR checksum=?)",
  )
    .bind(
      checksum,
      now(),
      JSON.stringify(stagedFile),
      uploadId,
      originalId,
      uploadId,
      checksum,
    )
    .run();
  if (!result.meta.changes) {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO file_cleanup(object_key,owner_id) SELECT ?,? WHERE NOT EXISTS(SELECT 1 FROM attachments WHERE object_key=?) AND NOT EXISTS(SELECT 1 FROM workspace_upload_files WHERE json_extract(payload,'$.object_key')=?)",
    )
      .bind(
        stagedFile.object_key,
        owner,
        stagedFile.object_key,
        stagedFile.object_key,
      )
      .run();
    throw new ApiError(
      409,
      "UPLOAD_CHANGED",
      "This upload was cancelled or changed.",
    );
  }
  return { uploaded: true };
}
export async function drainFileCleanup(env: Env) {
  const rows = await env.DB.prepare(
    "SELECT object_key FROM file_cleanup LIMIT 100",
  ).all<{ object_key: string }>();
  for (const row of rows.results) {
    await env.FILES.delete(row.object_key);
    await env.DB.prepare("DELETE FROM file_cleanup WHERE object_key=?")
      .bind(row.object_key)
      .run();
  }
}
export async function commitWorkspaceUpload(
  env: Env,
  owner: string,
  uploadId: string,
) {
  const current = await upload(env, owner, uploadId);
  if (current.response) return JSON.parse(current.response);
  const pending = await plan(env, current);
  const staged = await env.DB.prepare(
    "SELECT original_id,uploaded_at,payload FROM workspace_upload_files WHERE upload_id=?",
  )
    .bind(uploadId)
    .all<{
      original_id: string;
      uploaded_at: string | null;
      payload: string;
    }>();
  if (
    staged.results.length !== pending.files.length ||
    staged.results.some((file) => !file.uploaded_at)
  )
    throw new ApiError(
      409,
      "FILES_PENDING",
      "Upload every file before replacing the workspace.",
    );
  const stagedFiles = staged.results.map(
    (file) => JSON.parse(file.payload) as AttachmentRow,
  );
  for (const file of stagedFiles)
    if ((await env.FILES.head(file.object_key))?.size !== file.size)
      throw new ApiError(
        409,
        "FILES_PENDING",
        "A file is missing. Select the package again.",
      );
  const epoch = id(),
    guard = id(),
    result = {
      records: pending.manifest.records.length,
      files: pending.files.length,
      epoch,
    };
  const manifest = pending.manifest;
  try {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO write_guards(id,value) SELECT ?, EXISTS(SELECT 1 FROM workspace_state WHERE owner_id=? AND epoch=? AND generation=?) AND EXISTS(SELECT 1 FROM workspace_uploads WHERE id=? AND owner_id=? AND committed_at IS NULL AND expires_at>?)",
      ).bind(
        guard,
        owner,
        current.epoch,
        current.generation,
        uploadId,
        owner,
        now(),
      ),
      env.DB.prepare("DELETE FROM write_guards WHERE id=?").bind(guard),
      env.DB.prepare(
        "INSERT OR IGNORE INTO file_cleanup(object_key,owner_id) SELECT object_key,owner_id FROM attachments WHERE owner_id=?",
      ).bind(owner),
      env.DB.prepare("DELETE FROM goals WHERE owner_id=?").bind(owner),
      env.DB.prepare("DELETE FROM records WHERE owner_id=?").bind(owner),
      env.DB.prepare("DELETE FROM learning_source_cache WHERE owner_id=?").bind(
        owner,
      ),
      env.DB.prepare("DELETE FROM idempotency WHERE owner_id=?").bind(owner),
      ...bulkInsertRecords(env.DB, owner, manifest.records),
      ...bulkInsertLinks(env.DB, owner, manifest.records),
      ...bulkInsertAttachments(env.DB, stagedFiles),
      ...bulkInsertGoals(env.DB, owner, manifest.goals),
      env.DB.prepare(
        "INSERT INTO preferences(owner_id,data,updated_at) VALUES(?,?,?) ON CONFLICT(owner_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at",
      ).bind(owner, JSON.stringify(manifest.preferences), now()),
      env.DB.prepare(
        "UPDATE workspace_state SET epoch=? WHERE owner_id=?",
      ).bind(epoch, owner),
      env.DB.prepare(
        "UPDATE workspace_uploads SET committed_at=?,response=? WHERE id=? AND owner_id=? AND committed_at IS NULL",
      ).bind(now(), JSON.stringify(result), uploadId, owner),
      env.DB.prepare(
        "DELETE FROM workspace_upload_files WHERE upload_id=?",
      ).bind(uploadId),
    ]);
  } catch (error) {
    const latest = await upload(env, owner, uploadId);
    if (latest.response) return JSON.parse(latest.response);
    if (String(error).includes("CHECK constraint failed"))
      throw new ApiError(
        409,
        "WORKSPACE_CHANGED",
        "The workspace changed during upload. Select the package again.",
      );
    throw error;
  }
  await env.FILES.delete(planKey(owner, uploadId)).catch(() => {});
  await drainFileCleanup(env).catch(() => {});
  return result;
}
export async function cancelWorkspaceUpload(
  env: Env,
  owner: string,
  uploadId: string,
) {
  const current = await env.DB.prepare(
    "SELECT committed_at FROM workspace_uploads WHERE id=? AND owner_id=?",
  )
    .bind(uploadId, owner)
    .first<{ committed_at: string | null }>();
  if (!current)
    throw new ApiError(404, "NOT_FOUND", "This upload was not found.");
  if (current.committed_at) return { cancelled: false };
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO file_cleanup(object_key,owner_id) SELECT json_extract(f.payload,'$.object_key'),? FROM workspace_upload_files f JOIN workspace_uploads u ON u.id=f.upload_id WHERE u.id=? AND u.owner_id=? AND u.committed_at IS NULL",
    ).bind(owner, uploadId, owner),
    env.DB.prepare(
      "INSERT OR IGNORE INTO file_cleanup(object_key,owner_id) SELECT ?,? WHERE EXISTS(SELECT 1 FROM workspace_uploads WHERE id=? AND owner_id=? AND committed_at IS NULL)",
    ).bind(planKey(owner, uploadId), owner, uploadId, owner),
    env.DB.prepare(
      "DELETE FROM workspace_uploads WHERE id=? AND owner_id=? AND committed_at IS NULL",
    ).bind(uploadId, owner),
  ]);
  await drainFileCleanup(env).catch(() => {});
  return { cancelled: true };
}
export async function cleanupTransfers(env: Env) {
  const rows = await env.DB.prepare(
    "SELECT id,owner_id,committed_at FROM workspace_uploads WHERE expires_at<=? LIMIT 5",
  )
    .bind(now())
    .all<{ id: string; owner_id: string; committed_at: string | null }>();
  for (const row of rows.results) {
    if (!row.committed_at)
      await cancelWorkspaceUpload(env, row.owner_id, row.id);
    else {
      await env.FILES.delete(planKey(row.owner_id, row.id));
      await env.DB.prepare(
        "DELETE FROM workspace_uploads WHERE id=? AND committed_at IS NOT NULL",
      )
        .bind(row.id)
        .run();
    }
  }
  await drainFileCleanup(env);
}
