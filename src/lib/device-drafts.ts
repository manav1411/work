import { recordUrl, type WorkRecord } from "../../shared/model";
import { remapReference } from "./outbox";

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
    `work-rich-draft:${owner}:`,
    `work:application-draft:${owner}:`,
    `work:radar-draft:${owner}:`,
    `work:title-draft:${owner}:`,
    `work:preferences-draft:${owner}:`,
  ];
  const drafts: EditorDraft[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const storageKey = localStorage.key(i);
      if (!storageKey) continue;
      const key = storageKey;
      if (!prefixes.some((prefix) => key.startsWith(prefix))) continue;
      const value = localStorage.getItem(storageKey);
      if (value === null) continue;
      const parts = key.split(":");
      const id = key.startsWith(`work-content-draft:${owner}:story:`)
        ? (parts.at(-2) ?? "")
        : (parts.at(-1) ?? "");
      const record = records.find((item) => item.id === id);
      let title =
        record?.title ??
        (key.startsWith(`work:goal-draft:${owner}:`)
          ? "Action draft"
          : key.startsWith(`work:direction-draft:${owner}:`)
            ? "Goal draft"
            : key.startsWith(`work:latex-draft:${owner}:`)
              ? "LaTeX draft"
              : "Notes draft");
      try {
        const parsed = JSON.parse(value);
        const named = parsed?.value?.title ?? parsed?.title;
        if (typeof named === "string" && named) title = named;
      } catch {
        /* Note drafts are plain text. */
      }
      const contentPrefix = `work-content-draft:${owner}:`;
      const context = key.startsWith(contentPrefix)
        ? key.slice(contentPrefix.length)
        : "";
      const url = key.startsWith(`work:preferences-draft:${owner}:`)
        ? "/settings"
        : context.startsWith("story:") || key.includes(":story-title:")
          ? "/interviews?tab=behavioural"
          : key.includes(":document-title:")
            ? `/documents?record=${encodeURIComponent(id)}`
            : key.includes(":learn-title:") || key.includes(":workspace:learn:")
              ? `/learn?track=${encodeURIComponent(key.includes(":workspace:learn:") ? key.split(":workspace:learn:")[1].split(":")[0] : id)}`
              : key.includes(":interview-tab-title:")
                ? `/interviews?tab=${encodeURIComponent(id)}`
                : key.includes(":process-step-title:")
                  ? `/applications?record=${encodeURIComponent(parts.at(-2) ?? "")}`
                  : context.startsWith("interview:")
                    ? `/interviews?interview=${encodeURIComponent(id)}`
                    : context.startsWith("interview-tab:")
                      ? `/interviews?tab=${encodeURIComponent(id)}`
                      : key.startsWith(`work:latex-draft:${owner}:`)
                        ? `/documents?record=${encodeURIComponent(id)}`
                        : key.startsWith(`work:application-draft:${owner}:`) ||
                            key.startsWith(`work:radar-draft:${owner}:`)
                          ? `/applications?record=${encodeURIComponent(id)}`
                          : record
                            ? recordUrl(record)
                            : key.startsWith(contentPrefix)
                              ? "/interviews"
                              : key.startsWith(`work:goal-draft:${owner}:`)
                                ? `/goals?action=${encodeURIComponent(id)}`
                                : "/goals";
      drafts.push({
        key: storageKey,
        value,
        title,
        url,
      });
    }
  } catch {
    /* Device storage is optional. */
  }
  return drafts;
}

/** Move pending edits when an offline-created record receives its saved ID. */
export function remapEditorDrafts(owner: string, from: string, to: string) {
  for (const draft of editorDraftsFor(owner)) {
    const parts = draft.key.split(":");
    if (!parts.includes(from)) continue;
    const key = parts.map((part) => (part === from ? to : part)).join(":");
    let value = draft.value;
    try {
      value = JSON.stringify(remapReference(JSON.parse(value), from, to));
    } catch {
      /* Invalid drafts are ignored. */
    }
    try {
      localStorage.setItem(key, value);
      localStorage.removeItem(draft.key);
    } catch {
      /* Keep the original copy if device storage is unavailable. */
    }
  }
}
