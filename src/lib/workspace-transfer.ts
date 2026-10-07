import {
  MANIFEST_MAX_BYTES,
  MANIFEST_PATH,
  TAR_BLOCK_BYTES,
  readTarHeader,
  tarPadding,
  workspaceManifestSchema,
  workspacePackageError,
  type WorkspaceManifest,
} from "../../shared/transfer";
import { request, jsonRequest } from "./api";
import { clearWorkspaceDeviceStorage } from "./device-storage";
export interface WorkspaceUploadPackage {
  manifest: WorkspaceManifest;
  files: Map<string, Blob>;
}
export async function readWorkspacePackage(
  file: File,
): Promise<WorkspaceUploadPackage> {
  let offset = 0,
    manifest: WorkspaceManifest | undefined;
  const entries = new Map<string, Blob>();
  let ended = false;
  while (offset + TAR_BLOCK_BYTES <= file.size) {
    const header = readTarHeader(
      new Uint8Array(
        await file.slice(offset, offset + TAR_BLOCK_BYTES).arrayBuffer(),
      ),
    );
    offset += TAR_BLOCK_BYTES;
    if (!header) {
      if (file.size - offset < TAR_BLOCK_BYTES)
        throw new Error("The workspace export has an invalid ending.");
      for (let cursor = offset; cursor < file.size; cursor += 65536) {
        const bytes = new Uint8Array(
          await file.slice(cursor, cursor + 65536).arrayBuffer(),
        );
        if (bytes.some((byte) => byte !== 0))
          throw new Error("The workspace export has an invalid ending.");
      }
      ended = true;
      break;
    }
    if (
      entries.has(header.path) ||
      (header.path !== MANIFEST_PATH && !/^files\/\d{6}$/.test(header.path))
    )
      throw new Error("The export contains a duplicate or unexpected entry.");
    if (offset + header.size + tarPadding(header.size) > file.size)
      throw new Error("The workspace export is truncated.");
    const blob = file.slice(offset, offset + header.size);
    entries.set(header.path, blob);
    offset += header.size + tarPadding(header.size);
    if (header.path === MANIFEST_PATH) {
      if (header.size > MANIFEST_MAX_BYTES)
        throw new Error("Workspace metadata exceeds 32 MB.");
      manifest = workspaceManifestSchema.parse(
        JSON.parse(await blob.text()),
      ) as unknown as WorkspaceManifest;
    }
  }
  if (!ended || !manifest)
    throw new Error("Choose a current Work workspace export (.tar).");
  const error = workspacePackageError(manifest);
  if (error) throw new Error(error);
  const files = new Map<string, Blob>();
  for (const attachment of manifest.attachments) {
    const blob = entries.get(attachment.path);
    if (!blob || blob.size !== attachment.size)
      throw new Error(`Missing or incomplete file: ${attachment.filename}`);
    files.set(attachment.id, blob);
  }
  if (
    entries.size !== files.size + 1 ||
    new Set(manifest.attachments.map((file) => file.path)).size !== files.size
  )
    throw new Error("The file entries do not match the workspace metadata.");
  return { manifest, files };
}
export async function uploadWorkspacePackage(
  pkg: WorkspaceUploadPackage,
  onProgress: (uploaded: number, total: number) => void,
) {
  const { uploadId } = await request<{ uploadId: string }>(
    "/api/workspace/uploads",
    jsonRequest("POST", pkg.manifest),
  );
  let committed = false;
  try {
    let count = 0;
    onProgress(0, pkg.files.size);
    for (const [id, file] of pkg.files) {
      await request(
        `/api/workspace/uploads/${uploadId}/files/${encodeURIComponent(id)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream" },
          body: file,
        },
      );
      onProgress(++count, pkg.files.size);
    }
    const result = await request<{
      records: number;
      files: number;
      epoch: string;
    }>(`/api/workspace/uploads/${uploadId}/commit`, jsonRequest("POST", {}));
    committed = true;
    clearWorkspaceDeviceStorage();
    return result;
  } finally {
    if (!committed)
      await request(`/api/workspace/uploads/${uploadId}`, {
        method: "DELETE",
      }).catch(() => undefined);
  }
}
export async function downloadWorkspace() {
  const response = await fetch("/api/workspace", { method: "HEAD" });
  if (!response.ok)
    throw new Error(
      "The workspace could not be exported. Refresh and try again.",
    );
  const anchor = document.createElement("a");
  anchor.href = "/api/workspace";
  anchor.download = "work-workspace.tar";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
