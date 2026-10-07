import { latexEngineSchema, latexJobSchema } from "./latex";
import { z } from "zod";
import { field, safeUrl, type Attachment, type WorkRecord } from "./model";
import { normalizeWebUrl } from "./urls";

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

export function documentPdfFilename(
  record: WorkRecord | undefined,
  fallback = "document.pdf",
): string {
  switch (field(record, "type")) {
    case "resume":
      return "Manav_Dodia_Resume.pdf";
    case "letter":
      return "Manav_Dodia_Cover_Letter.pdf";
    default:
      return fallback;
  }
}

export function documentUrl(value: string): string {
  return webDestination(value);
}

export function webDestination(value: string): string {
  const safe = safeUrl(normalizeWebUrl(value));
  if (!safe || safe.length > 2048) return "";
  const url = new URL(safe);
  return !url.username && !url.password ? safe : "";
}

export const documentDestinationSchema = z
  .string()
  .max(2048)
  .transform(normalizeWebUrl)
  .refine(
    (value) => !value || !!documentUrl(value),
    "Use an HTTP or HTTPS URL without embedded credentials.",
  );
export const documentMetadataSchema = z
  .object({
    type: z.enum(["resume", "letter", "document"]),
    order: z.number().finite().optional(),
    latexProject: z
      .object({
        sourceId: z.string().min(1).max(160),
        mainFile: z.string().max(240),
        engine: latexEngineSchema,
        inputHash: z.string().max(160),
      })
      .strict()
      .optional(),
    latexJobs: z.array(latexJobSchema).max(1000).optional(),
    nativeDocument: z.literal(true).optional(),
    sourceUrl: documentDestinationSchema.optional(),
    primaryAttachmentId: z.string().max(160).optional(),
  })
  .strict();
export const profileLinkDataSchema = z
  .object({
    scope: z.literal("documents"),
    category: z.literal("profile-link"),
    url: z
      .string()
      .min(1)
      .max(2048)
      .transform(normalizeWebUrl)
      .refine(
        (value) => !!webDestination(value),
        "Use an HTTP or HTTPS URL without embedded credentials.",
      ),
  })
  .strict();

export function documentRecords(records: WorkRecord[]): WorkRecord[] {
  return records
    .filter((record) => record.kind === "asset")
    .sort(
      (a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
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
  return undefined;
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

/** Upload and pointer selection are separate commits so failed saves can retry. */
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
