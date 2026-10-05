import type { WorkRecord } from "./model";

export const CONNECTOR_PROVIDERS = ["notion", "github", "leetcode"] as const;
export type ConnectorProvider = (typeof CONNECTOR_PROVIDERS)[number];
export type ConnectorStatus =
  | "setting_up"
  | "updating"
  | "connected"
  | "attention"
  | "paused"
  | "linked"
  | "disconnected";
export interface ConnectorDefinition {
  provider: ConnectorProvider;
  name: string;
  description: string;
  purpose: string;
  tone: "aqua" | "blue" | "orange" | "pink";
  route: string;
}
export const CONNECTORS: ConnectorDefinition[] = [
  {
    provider: "notion",
    name: "Notion",
    purpose: "Notes & knowledge",
    description:
      "Bring your notes along. Keep writing in Notion and find them here.",
    tone: "aqua",
    route: "/notes",
  },
  {
    provider: "github",
    name: "GitHub",
    purpose: "Projects & evidence",
    description:
      "Keep project details current, then build the story behind your work.",
    tone: "blue",
    route: "/projects",
  },
  {
    provider: "leetcode",
    name: "LeetCode",
    purpose: "Practice progress",
    description:
      "Solve there. See your progress, reflect, and plan your next review here.",
    tone: "orange",
    route: "/practice",
  },
];
export interface ConnectorSelection {
  id: string;
  title: string;
  url: string;
  recordId?: string;
}
export interface ConnectorConnection {
  id: string;
  provider: ConnectorProvider;
  accountId: string;
  label: string;
  status: ConnectorStatus;
  config: {
    username?: string;
    projectUrl?: string;
    assetId?: string;
    selections?: ConnectorSelection[];
    includeDescendants?: boolean;
    mode?: "public" | "installation" | "internal" | "oauth";
  };
  snapshot: Record<string, unknown>;
  createdAt: string;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  nextSyncAt: string | null;
  error: string | null;
}
export interface ConnectorRun {
  id: string;
  connectionId: string;
  status: "success" | "failed" | "running";
  message: string;
  changed: number;
  startedAt: string;
  finishedAt: string | null;
}
export interface ExternalActivity {
  id: string;
  provider: ConnectorProvider;
  sourceKey: string;
  title: string;
  url: string;
  occurredAt: string;
  problemSlug?: string;
  recordId?: string;
}
export interface ConnectorsResponse {
  connections: ConnectorConnection[];
  available: { notionOAuth: boolean; notionToken: boolean; githubApp: boolean };
}
export interface ConnectorDiscovery {
  items: ConnectorSelection[];
  cursor: string | null;
}
export interface ConnectorSource {
  id: string;
  provider: ConnectorProvider;
  url: string;
  lastFetchedAt: string;
  sourceUpdatedAt: string | null;
  available: boolean;
  detached?: boolean;
}
export function recordSource(
  record: WorkRecord | undefined,
): ConnectorSource | null {
  const source = record?.data.connectorSource;
  if (!source || typeof source !== "object") return null;
  const value = source as Partial<ConnectorSource>;
  return typeof value.id === "string" &&
    CONNECTOR_PROVIDERS.includes(value.provider as ConnectorProvider) &&
    typeof value.url === "string"
    ? (value as ConnectorSource)
    : null;
}
export function connectorName(provider: ConnectorProvider): string {
  return (
    CONNECTORS.find((item) => item.provider === provider)?.name ?? provider
  );
}
