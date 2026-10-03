import { field, type RecordData, type WorkRecord } from "../../../shared/model";

export const CAREER_PATHS = [
  { value: "australia-transfer", label: "Australia → possible US transfer" },
  { value: "direct-us", label: "Apply directly in the US" },
  { value: "flutter-internal", label: "Explore a Flutter-group move" },
  { value: "other", label: "Other / undecided" },
];

export interface StageEvent {
  stage: string;
  at: string;
  previous: string;
}
export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}
export interface AssetVersion {
  assetId: string;
  version: number;
  label: string;
  title: string;
  capturedAt: string;
  body: string;
  attachmentId?: string;
  attachmentName?: string;
}

export function stageHistory(data: RecordData): StageEvent[] {
  const client = Array.isArray(data.history)
    ? data.history.filter((entry): entry is StageEvent => {
        if (typeof entry !== "object" || !entry) return false;
        const event = entry as Partial<StageEvent>;
        return (
          typeof event.stage === "string" &&
          typeof event.at === "string" &&
          typeof event.previous === "string"
        );
      })
    : [];
  if (!Array.isArray(data.stageHistory) || !data.stageHistory.length)
    return client;
  const server = data.stageHistory
    .filter(
      (entry): entry is { from: string; to: string; at: string } =>
        typeof entry === "object" &&
        entry !== null &&
        typeof entry.from === "string" &&
        typeof entry.to === "string" &&
        typeof entry.at === "string",
    )
    .map((event) => ({ previous: event.from, stage: event.to, at: event.at }));
  return server.length
    ? [...client.filter((event) => !event.previous), ...server]
    : client;
}

export function transitionApplication(
  record: WorkRecord,
  stage: string,
  at = new Date().toISOString(),
): RecordData {
  const previous = field(record, "stage", "Saved");
  if (previous === stage) return record.data;
  return {
    ...record.data,
    stage,
    history: [...stageHistory(record.data), { stage, previous, at }],
    ...(stage === "Applied" && !field(record, "submittedAt")
      ? { submittedAt: at.slice(0, 10) }
      : {}),
  };
}

export function checklist(data: RecordData): ChecklistItem[] {
  return Array.isArray(data.checklist)
    ? data.checklist.filter((entry): entry is ChecklistItem => {
        if (typeof entry !== "object" || !entry) return false;
        const item = entry as Partial<ChecklistItem>;
        return (
          typeof item.id === "string" &&
          typeof item.text === "string" &&
          typeof item.done === "boolean"
        );
      })
    : [];
}

export function checklistFromText(
  text: string,
  existing: ChecklistItem[] = [],
): ChecklistItem[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const previous = existing.find((item) => item.text === line);
      return (
        previous || {
          id: `check-${Date.now()}-${index}`,
          text: line,
          done: false,
        }
      );
    });
}

export function assetVersions(data: RecordData): AssetVersion[] {
  return Array.isArray(data.assetVersions)
    ? data.assetVersions.filter((entry): entry is AssetVersion => {
        if (typeof entry !== "object" || !entry) return false;
        const item = entry as Partial<AssetVersion>;
        return (
          typeof item.assetId === "string" &&
          typeof item.version === "number" &&
          typeof item.body === "string"
        );
      })
    : [];
}

export function captureAssetVersion(
  asset: WorkRecord,
  at = new Date().toISOString(),
): AssetVersion {
  return {
    assetId: asset.id,
    version: asset.version,
    title: asset.title,
    label: field(asset, "versionLabel", `v${asset.version}`),
    body: asset.body,
    capturedAt: at,
    ...(field(asset, "primaryAttachmentId")
      ? {
          attachmentId: field(asset, "primaryAttachmentId"),
          attachmentName: field(asset, "primaryAttachmentName"),
        }
      : {}),
  };
}

export function csvCell(value: unknown): string {
  const raw = String(value ?? "");
  // Neutralise spreadsheet formulas in user-provided cells.
  const safe = /^\s*[=+@-]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function applicationCSV(
  records: WorkRecord[],
  allRecords: WorkRecord[],
): string {
  const headers = [
    "Role",
    "Company",
    "Stage",
    "Location",
    "Career path",
    "Source URL",
    "Deadline",
    "Submitted",
    "Follow-up",
    "Next action",
    "Work-authorisation wording",
    "Compensation",
    "Requirements",
    "Resume versions",
  ];
  const rows = records.map((record) => [
    record.title,
    allRecords.find((candidate) => candidate.id === field(record, "companyId"))
      ?.title || "",
    field(record, "stage", "Saved"),
    field(record, "location"),
    field(record, "path"),
    field(record, "url"),
    field(record, "deadline"),
    field(record, "submittedAt"),
    field(record, "followUp"),
    field(record, "nextAction"),
    field(record, "workAuthorisation"),
    field(record, "compensation"),
    field(record, "requirements"),
    assetVersions(record.data)
      .map(
        (asset) => `${asset.title} ${asset.label} (record v${asset.version})`,
      )
      .join("; "),
  ]);
  return [headers, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
}

export function exportText(
  filename: string,
  contents: string,
  type = "text/plain;charset=utf-8",
): void {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const pathLabel = (value: string) =>
  CAREER_PATHS.find((path) => path.value === value)?.label ||
  value ||
  "Path not set";
export const normalizePath = (value: string) =>
  (
    ({
      "Australia → US": "australia-transfer",
      "australia-us": "australia-transfer",
      flutter: "flutter-internal",
      "Direct to the US": "direct-us",
    }) as Record<string, string>
  )[value] || value;
export const relatedRecords = (record: WorkRecord, records: WorkRecord[]) =>
  records.filter(
    (candidate) =>
      record.links.includes(candidate.id) ||
      candidate.links.includes(record.id),
  );
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Could not save. Please try again.";
