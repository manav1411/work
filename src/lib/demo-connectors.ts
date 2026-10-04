import {
  CONNECTOR_PROVIDERS,
  type ConnectorConnection,
  type ConnectorProvider,
  type ConnectorRun,
  type ConnectorSelection,
  type ConnectorSource,
  type ExternalActivity,
} from "../../shared/connectors";
import type { RecordInput, RecordPatch, WorkRecord } from "../../shared/model";
import { ApiError } from "./api";

export interface DemoSuggestion {
  id: string;
  provider: ConnectorProvider;
  title: string;
  reason: string;
  url: string;
  recordId?: string;
  status: "pending" | "accepted" | "dismissed";
}

export interface DemoConnectorState {
  connections: ConnectorConnection[];
  runs: ConnectorRun[];
  activity: ExternalActivity[];
  suggestions: DemoSuggestion[];
}

interface DemoConnectorDependencies {
  getRecords: () => WorkRecord[];
  createRecord: (input: RecordInput) => WorkRecord;
  updateRecord: (id: string, patch: RecordPatch) => WorkRecord;
  getConnectorState: () => DemoConnectorState | undefined;
  setConnectorState: (state: DemoConnectorState) => void;
}

interface DemoProviderItem extends ConnectorSelection {
  body: string;
  kind: RecordInput["kind"];
  data: Record<string, unknown>;
}

const stamp = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const initialState = (): DemoConnectorState => ({
  connections: [],
  runs: [],
  activity: [],
  suggestions: [],
});

const fixtures: Record<ConnectorProvider, DemoProviderItem[]> = {
  notion: [
    {
      id: "notion:career-notes",
      title: "Career notes and reflections",
      url: "https://www.notion.so/workspace/Career-notes-9a4c2e18b77c4ddc9a84f75ecda2b147",
      kind: "note",
      body: "## Career direction\n\nI enjoy making complex systems easier to use. I want to keep growing in product-minded engineering and thoughtful team leadership.\n\n## Recent reflection\n\nThe strongest project stories connect a user need to a clear decision, the work behind it, and what changed afterward.",
      data: {
        collection: "Career",
        sourceDescription: "A demo Notion page with career reflections.",
      },
    },
    {
      id: "notion:learning-log",
      title: "Learning log: platform engineering",
      url: "https://www.notion.so/workspace/Platform-learning-log-2b398c03a7d74814b62b2c7a5aaea825",
      kind: "note",
      body: "## Current focus\n\n- Make service ownership clearer\n- Improve observability before incidents\n- Document the path from local development to production\n\n### Next question\n\nWhich small reliability improvement would remove the most repeated work?",
      data: {
        collection: "Learning",
        sourceDescription: "A demo Notion learning note.",
      },
    },
    {
      id: "notion:project-retro",
      title: "Project retrospective: onboarding",
      url: "https://www.notion.so/workspace/Onboarding-retrospective-cb474678c75c48fdb08f084db48cf9b1",
      kind: "note",
      body: "## What worked\n\nSmall usability checks caught confusing setup steps before release.\n\n## What to improve\n\nBring support questions into planning sooner and keep the first-run checklist close to the code.",
      data: {
        collection: "Projects",
        sourceDescription: "A demo retrospective page.",
      },
    },
  ],
  github: [
    {
      id: "github:portfolio-dashboard",
      title: "portfolio-dashboard",
      url: "https://github.com/demo-builder/portfolio-dashboard",
      kind: "project",
      body: "A focused portfolio workspace that helps people turn project details into clear, evidence-backed stories.\n\nBuilt with TypeScript, React, and accessible component patterns. The project emphasizes responsive layouts, concise editing flows, and reusable UI foundations.",
      data: {
        repoUrl: "https://github.com/demo-builder/portfolio-dashboard",
        technologies: ["TypeScript", "React"],
        sourceDescription: "A demo repository for a portfolio dashboard.",
        sourceName: "portfolio-dashboard",
        topics: ["portfolio", "react", "accessibility"],
        archived: false,
        defaultBranch: "main",
      },
    },
    {
      id: "github:signal-board",
      title: "signal-board",
      url: "https://github.com/demo-builder/signal-board",
      kind: "project",
      body: "An incident signal board that gathers service health, recent deploys, and team notes into one calm operational view.\n\nDesigned to make the next useful action obvious during a busy handoff.",
      data: {
        repoUrl: "https://github.com/demo-builder/signal-board",
        technologies: ["TypeScript", "Cloudflare Workers"],
        sourceDescription: "A demo repository for an incident overview.",
        sourceName: "signal-board",
        topics: ["observability", "operations"],
        archived: false,
        defaultBranch: "main",
      },
    },
    {
      id: "github:design-system-notes",
      title: "design-system-notes",
      url: "https://github.com/demo-builder/design-system-notes",
      kind: "project",
      body: "A small set of design-system experiments covering keyboard behavior, responsive tokens, and component documentation.",
      data: {
        repoUrl: "https://github.com/demo-builder/design-system-notes",
        technologies: ["CSS", "Storybook"],
        sourceDescription: "A demo repository for design-system experiments.",
        sourceName: "design-system-notes",
        topics: ["design-system", "documentation"],
        archived: false,
        defaultBranch: "main",
      },
    },
  ],
  leetcode: [],
  overleaf: [
    {
      id: "overleaf:resume-source",
      title: "Résumé source — Product Engineer",
      url: "https://www.overleaf.com/project/65f1a89bd5d4c902341b7a21",
      kind: "asset",
      body: "Demo source for a résumé maintained in Overleaf. [Open the résumé source](https://www.overleaf.com/project/65f1a89bd5d4c902341b7a21) to continue editing the document.",
      data: {
        type: "resume",
        role: "Product Engineer",
        sourceDescription: "An example résumé source connected from Overleaf.",
      },
    },
  ],
};

function demoLeetSnapshot(username: string) {
  return {
    username,
    solved: { All: 186, Easy: 88, Medium: 87, Hard: 11 },
    easy: 88,
    medium: 87,
    hard: 11,
    ranking: 48231,
    recent: [
      {
        title: "Valid Parentheses",
        titleSlug: "valid-parentheses",
        difficulty: "Easy",
        status: "Accepted",
        occurredAt: stamp(),
      },
      {
        title: "Merge Intervals",
        titleSlug: "merge-intervals",
        difficulty: "Medium",
        status: "Accepted",
        occurredAt: new Date(Date.now() - 86400000).toISOString(),
      },
      {
        title: "Top K Frequent Elements",
        titleSlug: "top-k-frequent-elements",
        difficulty: "Medium",
        status: "Accepted",
        occurredAt: new Date(Date.now() - 2 * 86400000).toISOString(),
      },
    ],
  };
}

function demoLeetActivity(
  connection: ConnectorConnection,
  snapshot: ReturnType<typeof demoLeetSnapshot>,
): ExternalActivity[] {
  return snapshot.recent.map((item, index) => ({
    id: `${connection.id}:activity:${index}`,
    provider: "leetcode",
    sourceKey: `${item.titleSlug}:${item.occurredAt}`,
    title: item.title,
    url: `https://leetcode.com/problems/${item.titleSlug}/`,
    occurredAt: item.occurredAt,
    problemSlug: item.titleSlug,
  }));
}

function connectorError(message: string, status = 400): never {
  throw new ApiError(message, status);
}

function providerFor(path: string): ConnectorProvider | null {
  const match = /^\/api\/connectors\/([^/]+)/.exec(path);
  return match && CONNECTOR_PROVIDERS.includes(match[1] as ConnectorProvider)
    ? (match[1] as ConnectorProvider)
    : null;
}

export function assertDemoProviderPatch(
  previous: WorkRecord,
  patch: RecordPatch,
) {
  const source = previous.data.connectorSource as ConnectorSource | undefined;
  if (!source || source.detached) {
    if (
      patch.data?.connectorSource &&
      JSON.stringify(patch.data.connectorSource) !==
        JSON.stringify(previous.data.connectorSource)
    )
      connectorError("Source details are managed by your connector.", 400);
    return;
  }
  if (
    source.provider === "notion" &&
    ((patch.title !== undefined && patch.title !== previous.title) ||
      (patch.body !== undefined && patch.body !== previous.body))
  )
    connectorError("Edit this note in Notion, or make a Work copy first.", 409);
  const protectedKeys = [
    "connectorSource",
    "sourceName",
    "sourceDescription",
    "sourceReadme",
    "sourceTopics",
    "sourceArchived",
    "sourceDefaultBranch",
    "sourceLanguage",
    "sourceRepoUrl",
    "sourceWarnings",
  ];
  if (
    patch.data &&
    protectedKeys.some(
      (key) =>
        JSON.stringify(patch.data?.[key]) !==
        JSON.stringify(previous.data[key]),
    )
  )
    connectorError(
      "Keep the source details while editing your Work context. Reload and try again.",
      409,
    );
}

export function createDemoConnectorHandler(deps: DemoConnectorDependencies) {
  const getState = () => deps.getConnectorState() ?? initialState();
  const saveState = (next: DemoConnectorState) => deps.setConnectorState(next);
  const connection = (
    state: DemoConnectorState,
    provider: ConnectorProvider,
  ) => {
    const result = state.connections.find((item) => item.provider === provider);
    if (!result) connectorError("Connect this source first.", 404);
    return result;
  };
  const selectMappedRecords = (provider: ConnectorProvider) =>
    deps.getRecords().filter((item) => {
      const source = item.data.connectorSource as ConnectorSource | undefined;
      return source?.provider === provider && !source.detached;
    });

  function mappedRecord(
    provider: ConnectorProvider,
    selection: ConnectorSelection,
    existingId?: string,
  ) {
    const item = fixtures[provider].find(
      (candidate) => candidate.id === selection.id,
    );
    if (!item) connectorError("This demo source item is unavailable.", 404);
    const now = stamp();
    const source: ConnectorSource = {
      id: item.id,
      provider,
      url: item.url,
      lastFetchedAt: now,
      sourceUpdatedAt: now,
      available: true,
    };
    const input: RecordInput = {
      kind: item.kind,
      title: item.title,
      body: item.body,
      links: [],
      data: {
        ...item.data,
        connectorSource: source,
        ...(provider === "notion" ? { sourceName: item.title } : {}),
        ...(provider === "overleaf"
          ? { overleaf: item.url, sourceName: item.title }
          : {}),
      },
    };
    if (existingId) {
      const existing = deps
        .getRecords()
        .find((record) => record.id === existingId && !record.deletedAt);
      if (existing && provider === "github") {
        const sourceData = { ...input.data };
        delete sourceData.repoUrl;
        delete sourceData.technologies;
        return deps.updateRecord(existing.id, {
          data: { ...existing.data, ...sourceData },
        });
      }
      if (existing)
        return deps.updateRecord(existing.id, {
          ...input,
          data: { ...existing.data, ...input.data },
        });
    }
    return deps.createRecord(input);
  }

  function sync(
    provider: ConnectorProvider,
    current: ConnectorConnection,
    state: DemoConnectorState,
  ) {
    const startedAt = stamp();
    const selected = current.config.selections ?? [];
    const recordsBySource = new Map(
      deps
        .getRecords()
        .filter(
          (record) =>
            !record.deletedAt &&
            (record.data.connectorSource as ConnectorSource | undefined)
              ?.provider === provider &&
            !record.data.connectorCopy,
        )
        .map((record) => {
          const source = record.data.connectorSource as ConnectorSource;
          return [source.id, record] as const;
        }),
    );
    const selectedIds = new Set(selected.map((item) => item.id));
    for (const record of selectMappedRecords(provider)) {
      const source = record.data.connectorSource as ConnectorSource;
      if (selectedIds.has(source.id)) continue;
      deps.updateRecord(record.id, {
        body: record.body,
        data: {
          ...record.data,
          connectorSource: { ...source, detached: true, available: true },
        },
      });
    }
    let changed = 0;
    const synced: WorkRecord[] = [];
    for (const item of selected) {
      const target =
        item.recordId &&
        deps
          .getRecords()
          .find((record) => record.id === item.recordId && !record.deletedAt)
          ? item.recordId
          : (recordsBySource.get(item.id)?.id ??
            (provider === "overleaf" ? current.config.assetId : undefined));
      const record = mappedRecord(provider, item, target);
      synced.push(record);
      changed++;
    }
    if (provider === "overleaf" && selected.length === 0) {
      const fixture = fixtures.overleaf[0];
      const target =
        current.config.assetId ?? recordsBySource.get(fixture.id)?.id;
      synced.push(
        mappedRecord(
          "overleaf",
          { id: fixture.id, title: fixture.title, url: fixture.url },
          target,
        ),
      );
      changed++;
    }
    let activity = state.activity;
    let suggestions = state.suggestions;
    let snapshot = current.snapshot;
    if (provider === "leetcode") {
      const username = current.config.username ?? current.accountId;
      const leet = demoLeetSnapshot(username);
      snapshot = leet;
      activity = demoLeetActivity(current, leet);
      suggestions = [];
    }
    const finishedAt = stamp();
    const updated: ConnectorConnection = {
      ...current,
      status:
        current.status === "paused"
          ? "paused"
          : provider === "overleaf"
            ? "linked"
            : "connected",
      snapshot: {
        ...snapshot,
        ...(provider !== "leetcode"
          ? { selectedCount: selected.length, updatedAt: finishedAt }
          : {}),
      },
      lastAttemptAt: startedAt,
      lastSuccessAt: finishedAt,
      nextSyncAt: null,
      error: null,
    };
    const run: ConnectorRun = {
      id: id(),
      connectionId: current.id,
      status: "success",
      message:
        provider === "leetcode"
          ? "Demo profile activity refreshed."
          : `Refreshed ${changed} selected item${changed === 1 ? "" : "s"}.`,
      changed,
      startedAt,
      finishedAt,
    };
    const next: DemoConnectorState = {
      ...state,
      connections: state.connections.map((item) =>
        item.id === current.id ? updated : item,
      ),
      runs: [
        run,
        ...state.runs.filter((item) => item.connectionId === current.id),
      ]
        .slice(0, 30)
        .concat(state.runs.filter((item) => item.connectionId !== current.id)),
      activity,
      suggestions,
    };
    saveState(next);
    return { connection: updated, message: run.message, records: synced };
  }

  const handle = async (
    path: string,
    init?: RequestInit,
  ): Promise<{ handled: boolean; value?: unknown }> => {
    const url = new URL(path, "https://demo.invalid");
    const method = init?.method ?? "GET";
    let body: Record<string, unknown> = {};
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body) as Record<string, unknown>;
      } catch {
        connectorError("Invalid request body.");
      }
    }
    const isSuggestions =
      url.pathname === "/api/connectors/suggestions" ||
      url.pathname.startsWith("/api/connectors/suggestions/");
    const isActivity = url.pathname === "/api/connectors/activity";
    const isNotionCopy = url.pathname === "/api/connectors/notion/copy";
    const provider = providerFor(url.pathname);
    if (
      !provider &&
      !isSuggestions &&
      !isActivity &&
      !isNotionCopy &&
      url.pathname !== "/api/connectors"
    )
      return { handled: false };
    let state = getState();
    if (isNotionCopy && method === "POST") {
      const recordId = typeof body.recordId === "string" ? body.recordId : "";
      const sourceRecord = deps
        .getRecords()
        .find((record) => record.id === recordId && !record.deletedAt);
      const source = sourceRecord?.data.connectorSource as
        ConnectorSource | undefined;
      if (sourceRecord?.kind !== "note" || source?.provider !== "notion")
        connectorError("Choose a connected Notion note.", 400);
      const record = deps.createRecord({
        kind: "note",
        title: `${sourceRecord.title} — Work copy`.slice(0, 240),
        body: sourceRecord.body,
        tags: sourceRecord.tags,
        links: sourceRecord.links,
        data: {
          ...sourceRecord.data,
          connectorCopy: true,
          connectorSource: { ...source, detached: true, available: true },
        },
      });
      return { handled: true, value: { record } };
    }
    if (url.pathname === "/api/connectors" && method === "GET")
      return {
        handled: true,
        value: {
          connections: state.connections,
          available: { notionOAuth: true, notionToken: true, githubApp: true },
        },
      };
    if (isSuggestions && method === "GET")
      return {
        handled: true,
        value: {
          suggestions: state.suggestions.filter(
            (item) => item.status === "pending",
          ),
        },
      };
    if (isActivity && method === "GET") {
      const limit = Math.min(
        100,
        Math.max(1, Number(url.searchParams.get("limit") ?? 20) || 20),
      );
      const providerFilter = url.searchParams.get("provider");
      const filtered =
        providerFilter &&
        CONNECTOR_PROVIDERS.includes(providerFilter as ConnectorProvider)
          ? state.activity.filter((item) => item.provider === providerFilter)
          : state.activity;
      const offset = Math.max(
        0,
        Number(url.searchParams.get("cursor") ?? 0) || 0,
      );
      const activities = filtered.slice(offset, offset + limit);
      const cursor =
        offset + activities.length < filtered.length
          ? String(offset + activities.length)
          : null;
      return { handled: true, value: { activities, cursor } };
    }
    if (isSuggestions && method === "POST") {
      const suggestionId = decodeURIComponent(
        url.pathname.split("/").pop() ?? "",
      );
      const suggestion = state.suggestions.find(
        (item) => item.id === suggestionId,
      );
      if (!suggestion) connectorError("Suggestion not found.", 404);
      const action = body.action;
      if (action !== "accept" && action !== "dismiss")
        connectorError("Choose accept or dismiss.");
      let created: WorkRecord | undefined;
      if (action === "accept") {
        created = deps.createRecord({
          kind: "action",
          title: suggestion.title,
          body: suggestion.reason,
          links: suggestion.recordId ? [suggestion.recordId] : [],
          data: {
            connectorSuggestion: suggestion.id,
            sourceUrl: suggestion.url,
          },
        });
      }
      state = {
        ...state,
        suggestions: state.suggestions.map((item) =>
          item.id === suggestionId
            ? {
                ...item,
                status: action === "accept" ? "accepted" : "dismissed",
              }
            : item,
        ),
      };
      saveState(state);
      return {
        handled: true,
        value: {
          ...(created ? { record: created } : {}),
          suggestion: state.suggestions.find(
            (item) => item.id === suggestionId,
          ),
        },
      };
    }
    if (!provider) return { handled: false };
    if (url.pathname === `/api/connectors/${provider}` && method === "GET") {
      try {
        return {
          handled: true,
          value: { connection: connection(state, provider) },
        };
      } catch (error) {
        if (error instanceof ApiError && error.status === 404)
          return { handled: true, value: { connection: null } };
        throw error;
      }
    }
    if (
      url.pathname === `/api/connectors/${provider}/connect` &&
      method === "POST"
    ) {
      const before = state.connections.find(
        (item) => item.provider === provider,
      );
      if (before && before.status !== "disconnected")
        connectorError("This source is already connected.", 409);
      const projectUrl =
        typeof body.projectUrl === "string" ? body.projectUrl.trim() : "";
      const usernameInput =
        typeof body.username === "string"
          ? body.username.trim().replace(/^@/, "")
          : "";
      const profileUsername =
        provider === "leetcode" && !usernameInput
          ? (projectUrl.match(/leetcode\.com\/u\/([^/?#]+)/i)?.[1] ?? "")
          : "";
      const username = usernameInput || profileUsername;
      const accountId =
        provider === "notion"
          ? "demo-notion-workspace"
          : provider === "overleaf"
            ? "demo-overleaf-project"
            : username || `demo-${provider}`;
      const label =
        typeof body.label === "string" && body.label.trim()
          ? body.label.trim()
          : provider === "notion"
            ? "Demo Notion workspace"
            : provider === "github"
              ? username || "Demo GitHub"
              : provider === "leetcode"
                ? username || "Demo LeetCode profile"
                : "Demo résumé project";
      const current: ConnectorConnection = {
        id: before?.id || id(),
        provider,
        accountId,
        label,
        status: provider === "overleaf" ? "linked" : "connected",
        config: {
          ...(username ? { username } : {}),
          ...(projectUrl
            ? { projectUrl }
            : provider === "overleaf"
              ? { projectUrl: fixtures.overleaf[0].url }
              : {}),
          ...(provider === "overleaf" &&
          typeof body.assetId === "string" &&
          body.assetId
            ? { assetId: body.assetId }
            : {}),
          mode:
            provider === "github"
              ? "public"
              : provider === "notion"
                ? "internal"
                : "public",
          selections: [],
          includeDescendants: false,
        },
        snapshot:
          provider === "leetcode"
            ? demoLeetSnapshot(username || accountId)
            : {},
        createdAt: stamp(),
        lastSuccessAt: null,
        lastAttemptAt: null,
        nextSyncAt: null,
        error: null,
      };
      const snapshot =
        provider === "leetcode"
          ? demoLeetSnapshot(username || accountId)
          : undefined;
      const activity = snapshot ? demoLeetActivity(current, snapshot) : [];
      state = {
        ...state,
        connections: [
          ...state.connections.filter((item) => item.provider !== provider),
          current,
        ],
        ...(snapshot
          ? {
              activity: [
                ...state.activity.filter((item) => item.provider !== provider),
                ...activity,
              ],
              suggestions: [
                ...state.suggestions.filter(
                  (item) => item.provider !== provider,
                ),
              ],
            }
          : {}),
      };
      saveState(state);
      if (provider === "leetcode")
        return { handled: true, value: sync(provider, current, state) };
      return { handled: true, value: { connection: current } };
    }
    if (
      url.pathname === `/api/connectors/${provider}/authorize` &&
      method === "POST"
    ) {
      const existing = state.connections.find(
        (item) => item.provider === provider,
      );
      if (!existing || existing.status === "disconnected") {
        const label =
          provider === "github" ? "Demo GitHub App" : "Demo Notion workspace";
        const now = stamp();
        const connection: ConnectorConnection = {
          id: id(),
          provider,
          accountId: `demo-${provider}`,
          label,
          status: "connected",
          config: { mode: "oauth", selections: [], includeDescendants: false },
          snapshot: {},
          createdAt: now,
          lastSuccessAt: null,
          lastAttemptAt: null,
          nextSyncAt: null,
          error: null,
        };
        saveState({
          ...state,
          connections: [
            ...state.connections.filter((item) => item.provider !== provider),
            connection,
          ],
        });
      }
      const returnPath =
        typeof window === "undefined"
          ? "/connectors"
          : window.location.pathname;
      return {
        handled: true,
        value: { url: `${returnPath}?demoAuthorized=${provider}` },
      };
    }
    if (
      url.pathname === `/api/connectors/${provider}/discover` &&
      method === "GET"
    ) {
      connection(state, provider);
      const items = fixtures[provider];
      const offset = Math.max(
        0,
        Number(url.searchParams.get("cursor") ?? 0) || 0,
      );
      const page = items
        .slice(offset, offset + 2)
        .map(
          ({ body: _body, kind: _kind, data: _data, ...selection }) =>
            selection,
        );
      const next =
        offset + page.length < items.length
          ? String(offset + page.length)
          : null;
      return { handled: true, value: { items: page, cursor: next } };
    }
    if (
      url.pathname === `/api/connectors/${provider}/selection` &&
      method === "PUT"
    ) {
      const current = connection(state, provider);
      const selections = Array.isArray(body.selections)
        ? (body.selections as ConnectorSelection[])
        : [];
      const safeSelections = selections.flatMap((item) => {
        const fixture = fixtures[provider].find(
          (candidate) => candidate.id === item.id,
        );
        return fixture
          ? [
              {
                id: fixture.id,
                title: fixture.title,
                url: fixture.url,
                ...(typeof item.recordId === "string" && item.recordId
                  ? { recordId: item.recordId }
                  : {}),
              },
            ]
          : [];
      });
      const updated = {
        ...current,
        config: {
          ...current.config,
          selections: safeSelections,
          includeDescendants: body.includeDescendants === true,
        },
      };
      const keptIds = new Set(safeSelections.map((item) => item.id));
      for (const record of selectMappedRecords(provider)) {
        const source = record.data.connectorSource as ConnectorSource;
        if (keptIds.has(source.id)) continue;
        const data: Record<string, unknown> = {
          ...record.data,
          connectorSource: { ...source, detached: true, available: true },
        };
        if (body.retention === "remove")
          for (const key of Object.keys(data))
            if (
              (key.startsWith("source") && key !== "sourceDate") ||
              key === "connectorSource" ||
              key === "originalMarkdown"
            )
              delete data[key];
        deps.updateRecord(record.id, {
          data,
          ...(body.retention === "remove" && provider === "notion"
            ? { title: "Removed Notion source", body: "" }
            : {}),
        });
      }
      saveState({
        ...state,
        connections: state.connections.map((item) =>
          item.id === current.id ? updated : item,
        ),
      });
      return { handled: true, value: { connection: updated } };
    }
    if (
      url.pathname === `/api/connectors/${provider}/refresh` &&
      method === "POST"
    ) {
      const current = connection(state, provider);
      if (current.status === "paused")
        connectorError("Resume this connection before syncing.", 409);
      return { handled: true, value: sync(provider, current, state) };
    }
    if (
      url.pathname === `/api/connectors/${provider}/runs` &&
      method === "GET"
    ) {
      const current = connection(state, provider);
      return {
        handled: true,
        value: {
          runs: state.runs
            .filter((item) => item.connectionId === current.id)
            .slice(0, 30),
        },
      };
    }
    if (url.pathname === `/api/connectors/${provider}` && method === "PATCH") {
      const current = connection(state, provider);
      const paused = body.paused === true;
      const updated = {
        ...current,
        status: paused ? ("paused" as const) : ("connected" as const),
      };
      saveState({
        ...state,
        connections: state.connections.map((item) =>
          item.id === current.id ? updated : item,
        ),
      });
      return { handled: true, value: { connection: updated } };
    }
    if (url.pathname === `/api/connectors/${provider}` && method === "DELETE") {
      const current = connection(state, provider);
      const keep = body.retention !== "remove";
      for (const record of selectMappedRecords(provider)) {
        const source = record.data.connectorSource as ConnectorSource;
        const data: Record<string, unknown> = {
          ...record.data,
          connectorSource: { ...source, detached: true, available: true },
        };
        if (!keep)
          for (const key of Object.keys(data))
            if (
              (key.startsWith("source") && key !== "sourceDate") ||
              key === "connectorSource" ||
              key === "originalMarkdown"
            )
              delete data[key];
        deps.updateRecord(record.id, {
          title:
            !keep && record.kind === "note"
              ? "Removed Notion source"
              : record.title,
          body: !keep && record.kind === "note" ? "" : record.body,
          data,
        });
      }
      state = {
        ...state,
        connections: state.connections.map((item) =>
          item.id === current.id
            ? {
                ...item,
                status: "disconnected" as const,
                config: {},
                snapshot: {},
                nextSyncAt: null,
                error: null,
              }
            : item,
        ),
        ...(keep
          ? {}
          : {
              activity: state.activity.filter(
                (item) => item.provider !== provider,
              ),
              suggestions: state.suggestions.filter(
                (item) => item.provider !== provider,
              ),
            }),
      };
      saveState(state);
      return { handled: true, value: { success: true } };
    }
    return { handled: false };
  };

  return handle;
}
