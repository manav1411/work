import { z } from "zod";
import { field, safeUrl, type Attachment, type WorkRecord } from "./model";

export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const DOCX_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const DOCUMENT_FILE_TYPES = [
  "application/pdf",
  DOCX_TYPE,
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
] as const;
export const DOCUMENT_ACCEPT =
  ".pdf,.docx,.png,.jpg,.jpeg,.webp,.gif,.txt,.md,.csv,.json";

export function documentUrl(value: string): string {
  const safe = safeUrl(value.trim());
  if (!safe || safe.length > 2048) return "";
  const url = new URL(safe);
  return url.protocol === "https:" &&
    ["overleaf.com", "www.overleaf.com"].includes(url.hostname) &&
    !url.username &&
    !url.password &&
    /^\/(project|read)\/[a-zA-Z0-9_-]+\/?$/.test(url.pathname)
    ? safe
    : "";
}

export function webDestination(value: string): string {
  const safe = safeUrl(value.trim());
  if (!safe || safe.length > 2048) return "";
  const url = new URL(safe);
  return !url.username && !url.password ? safe : "";
}

export const documentDestinationSchema = z
  .string()
  .max(2048)
  .refine(
    (value) => !value || !!documentUrl(value),
    "Use an HTTPS Overleaf project or read-only link.",
  );
export const documentMetadataSchema = z
  .object({
    type: z.string().max(80).optional(),
    documentDefault: z.boolean().optional(),
    sourceUrl: documentDestinationSchema.optional(),
    overleaf: documentDestinationSchema.optional(),
    primaryAttachmentId: z.string().max(160).optional(),
  })
  .passthrough();
export const profileLinkDataSchema = z
  .object({
    scope: z.literal("documents"),
    category: z.literal("profile-link"),
    url: z
      .string()
      .min(1)
      .max(2048)
      .refine(
        (value) => !!webDestination(value),
        "Use an HTTP or HTTPS URL without embedded credentials.",
      ),
  })
  .passthrough();

export function documentRecords(records: WorkRecord[]): WorkRecord[] {
  return records
    .filter((record) => record.kind === "asset" && !record.deletedAt)
    .sort(
      (a, b) =>
        Number(b.data.documentDefault === true) -
          Number(a.data.documentDefault === true) ||
        b.updatedAt.localeCompare(a.updatedAt) ||
        a.id.localeCompare(b.id),
    );
}

/** Never resolve a primary pointer to another document's attachment. */
export function primaryDocumentFile(
  record: WorkRecord,
  attachments: Attachment[],
): Attachment | undefined {
  const own = attachments.filter((file) => file.recordId === record.id);
  const primary = field(record, "primaryAttachmentId");
  if (primary) return own.find((file) => file.id === primary);
  // Older uploaded assets did not always store a primary pointer.
  return own.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

export function documentPreviewKind(
  file: Attachment,
): "pdf" | "image" | "text" | "download" {
  if (file.contentType === "application/pdf") return "pdf";
  if (
    ["text/plain", "text/markdown", "text/csv", "application/json"].includes(
      file.contentType,
    )
  )
    return "text";
  return ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
    file.contentType,
  )
    ? "image"
    : "download";
}

export function documentUploadError(
  file: Pick<File, "name" | "type" | "size">,
): string {
  if (!file.size || file.size > DOCUMENT_MAX_BYTES)
    return "Choose a file containing data, no larger than 10 MB.";
  if (!DOCUMENT_FILE_TYPES.some((type) => type === file.type))
    return "Choose a PDF, DOCX, PNG, JPEG, WebP, GIF, text, Markdown, CSV, or JSON file.";
  return "";
}

export interface DocumentFileOperations {
  upload: () => Promise<Attachment>;
  select: (file: Attachment) => Promise<void>;
}

export class DocumentFileSaveError extends Error {
  attachment?: Attachment;
  constructor(message: string, attachment?: Attachment) {
    super(message);
    this.name = "DocumentFileSaveError";
    this.attachment = attachment;
  }
}

/** Upload and pointer selection are separate commits; older files are retained. */
export async function saveDocumentFile(
  operations: DocumentFileOperations,
  uploaded?: Attachment,
): Promise<Attachment> {
  let file = uploaded;
  try {
    file ??= await operations.upload();
    await operations.select(file);
    return file;
  } catch (failure) {
    throw new DocumentFileSaveError(
      failure instanceof Error
        ? failure.message
        : "The file could not be saved.",
      file,
    );
  }
}
