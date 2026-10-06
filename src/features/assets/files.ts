import type { Attachment, WorkRecord } from "../../../shared/model";
import {
  ApiError,
  downloadFile,
  getAttachmentUrl,
  jsonRequest,
  request,
} from "../../lib/api";

export async function documentBlob(
  file: Pick<Attachment, "id">,
): Promise<Blob> {
  const destination = await getAttachmentUrl(file.id);
  let response: Response;
  try {
    response = await fetch(destination, { credentials: "same-origin" });
  } catch {
    throw new ApiError("The file could not load. Reconnect and try again.");
  }
  if (!response.ok) {
    if (response.status === 401)
      throw new ApiError(
        "Your session expired. Sign in again to open this file.",
        401,
      );
    if (response.status === 404)
      throw new ApiError(
        "The uploaded file is unavailable. Its document details are still saved.",
        404,
      );
    throw new ApiError(
      "The file could not load. Please try again.",
      response.status,
    );
  }
  return response.blob();
}

export async function downloadDocumentFile(
  file: Pick<Attachment, "id" | "filename">,
  name = file.filename,
): Promise<void> {
  downloadFile(await documentBlob(file), name);
}

/** Confirm a server commit instead of placing a binary pointer in the offline outbox. */
export async function selectDocumentFile(
  recordId: string,
  file: Attachment,
): Promise<void> {
  if (file.recordId !== recordId)
    throw new ApiError("Choose a file uploaded to this document.", 400);
  const { record } = await request<{ record: WorkRecord }>(
    `/api/records/${encodeURIComponent(recordId)}`,
  );
  await request(`/api/records/${encodeURIComponent(recordId)}`, {
    ...jsonRequest("PATCH", {
      version: record.version,
      data: { ...record.data, primaryAttachmentId: file.id },
    }),
    headers: { "Idempotency-Key": crypto.randomUUID() },
  });
}
