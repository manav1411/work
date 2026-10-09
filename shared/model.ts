export const RECORD_KINDS = [
  "note",
  "company",
  "application",
  "interview",
  "story",
  "topic",
  "asset",
  "path",
  "decision",
  "resource",
  "rotation",
] as const;

export type RecordKind = (typeof RECORD_KINDS)[number];
export type RecordData = Record<string, unknown>;

export interface WorkRecord {
  id: string;
  kind: RecordKind;
  title: string;
  body: string;
  tags: string[];
  links: string[];
  data: RecordData;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface RecordInput {
  kind: RecordKind;
  title: string;
  body?: string;
  tags?: string[];
  links?: string[];
  data?: RecordData;
}

export type RecordPatch = Partial<Omit<RecordInput, "kind">>;

export interface WorkUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
}

export interface UserPreferences {
  timezone: string;
  theme: "light" | "dark";
  displayName: string;
  leetcode: string;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  timezone: "Australia/Melbourne",
  theme: "light",
  displayName: "",
  leetcode: "",
};

export interface Attachment {
  id: string;
  recordId: string;
  filename: string;
  contentType: string;
  size: number;
  createdAt: string;
}

export interface SessionResponse {
  user: WorkUser | null;
  local: boolean;
  configured: boolean;
}

export const field = (
  record: WorkRecord | undefined,
  key: string,
  fallback = "",
): string => {
  const value = record?.data[key];
  return typeof value === "string" ? value : fallback;
};
export const numberField = (
  record: WorkRecord | undefined,
  key: string,
  fallback = 0,
): number => {
  const value = record?.data[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};
export const boolField = (
  record: WorkRecord | undefined,
  key: string,
): boolean => record?.data[key] === true;
export const arrayField = (
  record: WorkRecord | undefined,
  key: string,
): string[] => {
  const value = record?.data[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
};

export const KIND_LABELS: Record<RecordKind, string> = {
  note: "Notes",
  company: "Radar company",
  application: "Application",
  interview: "Appointment",
  story: "STAR story",
  topic: "Learning tab",
  asset: "Document",
  path: "Direction",
  decision: "Decision",
  resource: "Profile link",
  rotation: "Experience",
};
export const recordUrl = (record: WorkRecord): string => {
  const id = encodeURIComponent(record.id);
  if (record.kind === "company") return `/applications?tab=radar&record=${id}`;
  if (record.kind === "application") return `/applications?record=${id}`;
  if (record.kind === "interview") return `/applications?interview=${id}`;
  if (record.kind === "asset" || record.kind === "resource")
    return `/documents?record=${id}`;
  if (["path", "rotation", "decision"].includes(record.kind))
    return `/goals?goal=${id}`;
  if (record.kind === "topic" || record.data.scope === "learn")
    return `/learn?track=${encodeURIComponent(field(record, "track", field(record, "seedId", record.id)))}`;
  if (record.kind === "story") return "/interviews?tab=behavioural";
  return field(record, "interviewId")
    ? `/interviews?interview=${encodeURIComponent(field(record, "interviewId"))}`
    : `/interviews?tab=${encodeURIComponent(field(record, "tabId", field(record, "tabKey", record.id)))}`;
};

export function localDate(
  date = new Date(),
  timezone = "Australia/Melbourne",
): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function niceDate(
  value: string,
  timezone = "Australia/Melbourne",
): string {
  if (!value) return "No date yet";
  const parsed = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-AU", {
    month: "short",
    day: "numeric",
    timeZone: value.length === 10 ? "UTC" : timezone,
  }).format(parsed);
}

export function safeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
