import {
  field,
  safeUrl,
  type UserPreferences,
  type WorkRecord,
} from "../../../shared/model";

export type DocumentType = "resume" | "letter";
export interface DocumentLink {
  url: string;
  record?: WorkRecord;
}

/** Links are destinations, not snapshots of the document's current contents. */
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
    candidates.find(
      (item) =>
        documentUrl(field(item, "sourceUrl")) ||
        documentUrl(field(item, "overleaf")),
    );
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
