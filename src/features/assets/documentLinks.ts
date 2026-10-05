import {
  field,
  type UserPreferences,
  type WorkRecord,
} from "../../../shared/model";
import { documentUrl } from "../../../shared/documents";
export { documentUrl, webDestination } from "../../../shared/documents";

export type DocumentType = "resume" | "letter";
export interface DocumentLink {
  url: string;
  record?: WorkRecord;
}

function getDocument(records: WorkRecord[], type: DocumentType): DocumentLink {
  const candidates = records
    .filter(
      (record) =>
        record.kind === "asset" &&
        !record.deletedAt &&
        (field(record, "type") === type ||
          (type === "letter" && field(record, "type") === "cover-letter")),
    )
    .sort(
      (a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
    );
  const record =
    candidates.find((item) => item.data.documentDefault === true) ||
    candidates.find((item) => field(item, "primaryAttachmentId")) ||
    candidates.find(
      (item) =>
        documentUrl(field(item, "sourceUrl")) ||
        documentUrl(field(item, "overleaf")),
    ) ||
    candidates[0];
  if (!record) return { url: "" };
  // A deliberately cleared default must not revive an old preference or duplicate.
  const value =
    record.data.documentDefault === true
      ? field(record, "sourceUrl", field(record, "overleaf"))
      : documentUrl(field(record, "sourceUrl")) || field(record, "overleaf");
  return { record, url: documentUrl(value) };
}

export function getDocumentLinks(
  records: WorkRecord[],
  preferences: Pick<UserPreferences, "overleaf">,
) {
  const resume = getDocument(records, "resume");
  return {
    resume: resume.record ? resume : { url: documentUrl(preferences.overleaf) },
    coverLetter: getDocument(records, "letter"),
  };
}
