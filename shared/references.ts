const recordKeys = new Set([
  "companyId",
  "applicationId",
  "contactId",
  "assetId",
  "projectId",
  "achievementId",
  "rotationId",
  "actionId",
  "decisionId",
  "recordId",
]);
const fileKeys = new Set(["attachmentId", "primaryAttachmentId"]);
const recordArrayKeys = new Set(["assetIds", "recordIds", "companyIds"]);

function isRecordReference(key: string, value: string) {
  return (
    recordKeys.has(key) ||
    (["problemId", "topicId"].includes(key) && /^[0-9a-f-]{36}$/i.test(value))
  );
}

export function dataReferences(data: Record<string, unknown>): {
  records: string[];
  files: string[];
} {
  const records = new Set<string>();
  const files = new Set<string>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (typeof child === "string" && child) {
        if (isRecordReference(key, child)) records.add(child);
        if (fileKeys.has(key)) files.add(child);
      }
      if (Array.isArray(child) && recordArrayKeys.has(key))
        for (const item of child)
          if (typeof item === "string" && item) records.add(item);
      if (child && typeof child === "object") visit(child);
    }
  };
  visit(data);
  return { records: [...records], files: [...files] };
}

// Detach relations, not user-authored text or captured résumé/story content.
// Empty scalar relations keep the same representation as an unselected field.
export function detachDataReferences(
  data: Record<string, unknown>,
  records: ReadonlySet<string>,
  files: ReadonlySet<string>,
): Record<string, unknown> {
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => {
        if (
          typeof child === "string" &&
          ((isRecordReference(key, child) && records.has(child)) ||
            (fileKeys.has(key) && files.has(child)))
        )
          return [key, ""];
        if (Array.isArray(child) && recordArrayKeys.has(key))
          return [
            key,
            child.filter((item) => !records.has(item as string)).map(visit),
          ];
        return [key, visit(child)];
      }),
    );
  };
  return visit(data) as Record<string, unknown>;
}
