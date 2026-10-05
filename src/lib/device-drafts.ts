import { recordUrl, type WorkRecord } from "../../shared/model";

export interface EditorDraft {
  key: string;
  value: string;
  title: string;
  url: string;
}
export function editorDraftsFor(
  owner: string,
  records: WorkRecord[] = [],
): EditorDraft[] {
  if (!owner) return [];
  const prefixes = [
    `work-content-draft:${owner}:`,
    `work:goal-draft:${owner}:`,
    `work:direction-draft:${owner}:`,
    `work:latex-draft:${owner}:`,
  ];
  const drafts: EditorDraft[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !prefixes.some((prefix) => key.startsWith(prefix))) continue;
      const value = localStorage.getItem(key);
      if (value === null) continue;
      const id = key.split(":").at(-1) ?? "";
      const record = records.find((item) => item.id === id);
      let title =
        record?.title ??
        (key.startsWith(`work:goal-draft:${owner}:`)
          ? "Goal draft"
          : key.startsWith(`work:direction-draft:${owner}:`)
            ? "Direction draft"
            : key.startsWith(`work:latex-draft:${owner}:`)
              ? "LaTeX draft"
              : "Notes draft");
      try {
        const parsed = JSON.parse(value);
        if (typeof parsed?.title === "string" && parsed.title)
          title = parsed.title;
      } catch {
        /* Note drafts are plain text. */
      }
      const contentPrefix = `work-content-draft:${owner}:`;
      const context = key.startsWith(contentPrefix)
        ? key.slice(contentPrefix.length)
        : "";
      const url = context.startsWith("interview:")
        ? `/interviews?interview=${encodeURIComponent(id)}`
        : context.startsWith("interview-tab:")
          ? `/interviews?tab=${encodeURIComponent(id)}`
          : key.startsWith(`work:latex-draft:${owner}:`)
            ? `/documents?record=${encodeURIComponent(id)}`
            : record
              ? recordUrl(record)
              : key.startsWith(contentPrefix)
                ? "/interviews"
                : "/direction";
      drafts.push({ key, value, title, url });
    }
  } catch {
    /* Device storage is optional. */
  }
  return drafts;
}
