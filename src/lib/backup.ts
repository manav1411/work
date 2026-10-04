import {
  BACKUP_MANIFEST_MAX_BYTES,
  BACKUP_MANIFEST_PATH,
  TAR_BLOCK_BYTES,
  backupStructureError,
  legacyWorkBackupSchema,
  readTarHeader,
  tarPadding,
  workBackupManifestSchema,
  type BackupRestoreResult,
  type WorkBackupManifest,
} from "../../shared/backup";
import { downloadFile, jsonRequest, request } from "./api";

export interface WorkBackupPreview {
  manifest: WorkBackupManifest;
  file: File;
  format: "tar" | "json";
  entries: Map<string, { offset: number; size: number }>;
  legacyFiles?: Map<string, string>;
  restoreId?: string;
}

function checkStructure(manifest: WorkBackupManifest) {
  const error = backupStructureError(manifest);
  if (error) throw new Error(error);
}

export async function previewWorkBackup(
  file: File,
): Promise<WorkBackupPreview> {
  const prefix = await file.slice(0, TAR_BLOCK_BYTES).text();
  if (prefix.trimStart().startsWith("{")) {
    if (file.size > BACKUP_MANIFEST_MAX_BYTES)
      throw new Error(
        "Legacy JSON backups must be no larger than 32 MB. New TAR backups support larger file collections.",
      );
    let input: unknown;
    try {
      input = JSON.parse(await file.text());
    } catch {
      throw new Error("This JSON backup could not be read.");
    }
    const result = legacyWorkBackupSchema.safeParse(input);
    if (!result.success)
      throw new Error(
        "This file is not a supported Work v1 or v2 JSON backup.",
      );
    const backup = result.data;
    const legacyFiles = new Map(
      backup.attachments.flatMap((file) =>
        file.base64 ? [[file.id, file.base64] as const] : [],
      ),
    );
    const manifest = {
      ...backup,
      format: "work-backup",
      version: 3,
      attachments: backup.attachments.map(({ base64, ...file }, index) => ({
        ...file,
        path: `attachments/${String(index).padStart(6, "0")}`,
        ...(!base64 ? { missing: true } : {}),
      })),
    } as WorkBackupManifest;
    checkStructure(manifest);
    return { manifest, file, format: "json", entries: new Map(), legacyFiles };
  }
  const entries = new Map<string, { offset: number; size: number }>();
  let position = 0;
  let manifest: WorkBackupManifest | undefined;
  let terminated = false;
  while (position + TAR_BLOCK_BYTES <= file.size) {
    const header = new Uint8Array(
      await file.slice(position, position + TAR_BLOCK_BYTES).arrayBuffer(),
    );
    const entry = readTarHeader(header);
    if (!entry) {
      const end = new Uint8Array(
        await file
          .slice(position + TAR_BLOCK_BYTES, position + TAR_BLOCK_BYTES * 2)
          .arrayBuffer(),
      );
      if (
        end.length !== TAR_BLOCK_BYTES ||
        end.some((byte) => byte !== 0) ||
        position + TAR_BLOCK_BYTES * 2 !== file.size
      )
        throw new Error(
          "The backup archive is truncated or contains unexpected trailing data.",
        );
      terminated = true;
      break;
    }
    if (entries.has(entry.path))
      throw new Error("The backup contains a duplicate archive entry.");
    const offset = position + TAR_BLOCK_BYTES;
    const next = offset + entry.size + tarPadding(entry.size);
    if (!Number.isSafeInteger(next) || next > file.size)
      throw new Error("The backup archive is truncated.");
    if (entry.path === BACKUP_MANIFEST_PATH) {
      if (position !== 0 || entry.size > BACKUP_MANIFEST_MAX_BYTES)
        throw new Error(
          "The backup manifest is missing, misplaced or too large.",
        );
      let input: unknown;
      try {
        input = JSON.parse(
          await file.slice(offset, offset + entry.size).text(),
        );
      } catch {
        throw new Error("The backup manifest could not be read.");
      }
      const result = workBackupManifestSchema.safeParse(input);
      if (!result.success)
        throw new Error("This file is not a supported Work backup archive.");
      manifest = result.data as WorkBackupManifest;
      checkStructure(manifest);
    } else if (!manifest || !/^attachments\/\d{6}$/.test(entry.path)) {
      throw new Error("The backup contains an unexpected archive entry.");
    }
    entries.set(entry.path, { offset, size: entry.size });
    position = next;
  }
  if (!manifest || !terminated)
    throw new Error("The backup archive is incomplete.");
  const paths = new Set<string>();
  for (const attachment of manifest.attachments) {
    if (!attachment.path || paths.has(attachment.path))
      throw new Error(
        "The backup contains missing or duplicate attachment paths.",
      );
    paths.add(attachment.path);
    const entry = entries.get(attachment.path);
    if (attachment.missing ? !!entry : !entry || entry.size !== attachment.size)
      throw new Error(
        `The backup file for ${attachment.filename} is missing or does not match its metadata.`,
      );
  }
  if (
    entries.size !==
    manifest.attachments.filter((file) => !file.missing).length + 1
  )
    throw new Error("The archive contains a file absent from its manifest.");
  return { manifest, file, format: "tar", entries };
}

export async function downloadWorkBackup(
  mode: "demo" | "cloud" | "local" = "cloud",
): Promise<void> {
  if (mode === "demo") {
    const backup = await request<{ exportedAt: string }>("/api/export");
    downloadFile(
      JSON.stringify(backup, null, 2),
      `work-backup-${backup.exportedAt.slice(0, 10)}.json`,
      "application/json",
    );
    return;
  }
  const anchor = document.createElement("a");
  anchor.href = "/api/backup";
  anchor.download = `work-backup-${new Date().toISOString().slice(0, 10)}.tar`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

async function backupFile(
  preview: WorkBackupPreview,
  fileId: string,
): Promise<Blob> {
  const metadata = preview.manifest.attachments.find(
    (file) => file.id === fileId,
  );
  if (!metadata) throw new Error("This attachment is not in the backup.");
  if (preview.format === "tar") {
    const entry = preview.entries.get(metadata.path!);
    if (!entry)
      throw new Error(`The backup has no contents for ${metadata.filename}.`);
    return preview.file.slice(
      entry.offset,
      entry.offset + entry.size,
      metadata.contentType,
    );
  }
  const base64 = preview.legacyFiles?.get(fileId);
  if (!base64)
    throw new Error(`The backup has no contents for ${metadata.filename}.`);
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(base64), (character) =>
      character.charCodeAt(0),
    );
  } catch {
    throw new Error(
      `The backup contents for ${metadata.filename} are invalid.`,
    );
  }
  if (bytes.length !== metadata.size)
    throw new Error(
      `The backup size for ${metadata.filename} does not match its metadata.`,
    );
  return new Blob([bytes as Uint8Array<ArrayBuffer>], {
    type: metadata.contentType,
  });
}

export async function restoreWorkBackup(
  preview: WorkBackupPreview,
  mode?: "demo" | "cloud" | "local",
): Promise<BackupRestoreResult> {
  const demo =
    mode === "demo" ||
    (!mode &&
      typeof sessionStorage !== "undefined" &&
      sessionStorage.getItem("work-demo-active") === "true");
  if (demo) {
    const attachments = [];
    for (const file of preview.manifest.attachments.map(
      ({ path: _path, ...metadata }) => metadata,
    )) {
      let base64: string | undefined;
      if (!file.missing) {
        const bytes = new Uint8Array(
          await (await backupFile(preview, file.id)).arrayBuffer(),
        );
        const chunks: string[] = [];
        for (let offset = 0; offset < bytes.length; offset += 8192)
          chunks.push(
            String.fromCharCode(...bytes.subarray(offset, offset + 8192)),
          );
        base64 = btoa(chunks.join(""));
      }
      attachments.push({ ...file, ...(base64 ? { base64 } : {}) });
    }
    return request<BackupRestoreResult>(
      "/api/restore",
      jsonRequest("POST", {
        ...preview.manifest,
        format: "work-export",
        version: 2,
        attachments,
      }),
    );
  }
  const start = await request<{
    restoreId: string;
    uploaded: string[];
    committed?: BackupRestoreResult;
  }>(
    "/api/backup/restores",
    jsonRequest("POST", { manifest: preview.manifest }),
  );
  if (start.committed) return start.committed;
  preview.restoreId = start.restoreId;
  const uploaded = new Set(start.uploaded);
  for (const file of preview.manifest.attachments) {
    if (file.missing || uploaded.has(file.id)) continue;
    const blob = await backupFile(preview, file.id);
    await request(
      `/api/backup/restores/${encodeURIComponent(start.restoreId)}/files/${encodeURIComponent(file.id)}`,
      {
        method: "PUT",
        headers: { "Content-Type": file.contentType },
        body: blob,
      },
    );
  }
  return request<BackupRestoreResult>(
    `/api/backup/restores/${encodeURIComponent(start.restoreId)}/commit`,
    jsonRequest("POST", {}),
  );
}
