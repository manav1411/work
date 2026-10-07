import { field, type WorkRecord } from "../../../shared/model";
export { webDestination } from "../../../shared/documents";

export type DocumentType = "resume" | "letter";
export interface DocumentLink {
  record?: WorkRecord;
}

function getDocument(records: WorkRecord[], type: DocumentType): DocumentLink {
  const candidates = records
    .filter(
      (record) => record.kind === "asset" && field(record, "type") === type,
    )
    .sort(
      (a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
    );
  const record =
    candidates.find((item) => item.data.latexProject) ||
    candidates.find((item) => field(item, "primaryAttachmentId"));
  return record ? { record } : {};
}

export function getDocumentLinks(records: WorkRecord[]) {
  return {
    resume: getDocument(records, "resume"),
    coverLetter: getDocument(records, "letter"),
  };
}
