export const RECORD_KINDS = [
  "action",
  "note",
  "company",
  "application",
  "contact",
  "interview",
  "story",
  "practice",
  "topic",
  "progress",
  "achievement",
  "project",
  "asset",
  "path",
  "decision",
  "review",
  "focus",
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
  deletedAt: string | null;
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
  github: string;
  linkedin: string;
  website: string;
  leetcode: string;
  currentCompany: string;
  stack: string;
  weeklyHours: number;
  weeklyApplications: number;
  weeklyPractice: number;
  customStages: string[];
  reducedMotion: boolean;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  timezone: "Australia/Melbourne",
  theme: "light",
  displayName: "",
  github: "",
  linkedin: "",
  website: "",
  leetcode: "",
  currentCompany: "",
  stack: "",
  weeklyHours: 4,
  weeklyApplications: 3,
  weeklyPractice: 3,
  customStages: [
    "Saved",
    "Researching",
    "Ready to apply",
    "Applied",
    "Assessment",
    "Interview",
    "Offer",
    "Accepted",
    "Rejected",
    "Withdrawn",
  ],
  reducedMotion: false,
};

export interface Attachment {
  id: string;
  recordId: string;
  filename: string;
  contentType: string;
  size: number;
  createdAt: string;
}

export interface RecordRevision {
  id: string;
  recordId: string;
  version: number;
  title: string;
  body: string;
  tags: string[];
  links: string[];
  data: RecordData;
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
  action: "Action",
  note: "Note",
  company: "Company",
  application: "Application",
  contact: "Contact",
  interview: "Interview",
  story: "Story",
  practice: "Practice attempt",
  topic: "Learning topic",
  progress: "Learning progress",
  achievement: "Work evidence",
  project: "Project",
  asset: "Career asset",
  path: "Career path",
  decision: "Decision",
  review: "Weekly review",
  focus: "Focus session",
  resource: "Resource",
  rotation: "Rotation",
};

export const KIND_ROUTES: Record<RecordKind, string> = {
  action: "/settings",
  note: "/settings",
  company: "/applications",
  application: "/applications",
  contact: "/settings",
  interview: "/applications",
  story: "/interviews",
  practice: "/learn",
  topic: "/learn",
  progress: "/learn",
  achievement: "/settings",
  project: "/settings",
  asset: "/documents",
  path: "/direction",
  decision: "/direction",
  review: "/settings",
  focus: "/settings",
  resource: "/settings",
  rotation: "/direction",
};

export const recordUrl = (record: WorkRecord): string => {
  const recovery = `/settings?legacy=${record.kind}&record=${encodeURIComponent(record.id)}#recovery`;
  if (record.kind === "company")
    return `/applications?tab=radar&record=${encodeURIComponent(record.id)}`;
  if (record.kind === "note" || record.kind === "resource") {
    if (
      field(record, "scope") === "interviews" ||
      field(record, "category").startsWith("interview-")
    ) {
      const interview = field(record, "interviewId");
      return interview
        ? `/interviews?interview=${encodeURIComponent(interview)}`
        : `/interviews?tab=${encodeURIComponent(field(record, "tabId", field(record, "tabKey", record.id)))}`;
    }
    if (field(record, "scope") === "learn")
      return `/learn?track=${encodeURIComponent(field(record, "track", "dsa"))}`;
    if (field(record, "scope") === "documents") return "/documents";
  }
  if (
    record.kind === "practice" ||
    (record.kind === "progress" && record.data.category === "problem")
  ) {
    const slug = field(record, "problemSlug") || field(record, "problemId");
    return slug
      ? `/learn?view=roadmap&problem=${encodeURIComponent(slug)}`
      : recovery;
  }
  if (record.kind === "progress") return recovery;
  if (record.kind === "topic") {
    const track = field(record, "track");
    return track ? `/learn?track=${encodeURIComponent(track)}` : recovery;
  }
  if (record.kind === "interview")
    return `/applications?interview=${encodeURIComponent(record.id)}`;
  return KIND_ROUTES[record.kind] === "/settings"
    ? recovery
    : `${KIND_ROUTES[record.kind]}?record=${encodeURIComponent(record.id)}`;
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
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
