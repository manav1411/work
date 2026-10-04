import { readFileSync } from "node:fs";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { Hono } from "hono";
import { app } from "../worker";
import { ApiError, type Env } from "../worker/env";
import { newRecord, writeRecord } from "../worker/db/records";
import { saveConnection } from "../worker/connectors/oauth";
import { syncConnection } from "../worker/connectors/sync";
import { connectorWebhooks } from "../worker/connectors/webhooks";
import { exportWorkspace, restoreWorkspace } from "../worker/import-export";
import type { WorkRecord } from "../shared/model";
import { recordSource, type ExternalActivity } from "../shared/connectors";

let miniflare: Miniflare;
let env: Env;
let owner: string;

const legacyWebhooks = new Hono<{ Bindings: Env }>();
legacyWebhooks.route("/", connectorWebhooks);
legacyWebhooks.onError((error, context) => {
  if (error instanceof ApiError)
    return context.json(
      { error: { code: error.code, message: error.message } },
      error.status as 400,
    );
  throw error;
});

const migration = [
  "0001_workspace.sql",
  "0002_submitted_files.sql",
  "0003_connectors.sql",
  "0004_simplification.sql",
]
  .map((filename) =>
    readFileSync(new URL(`../migrations/${filename}`, import.meta.url), "utf8"),
  )
  .join("\n");

async function request(
  path: string,
  method = "GET",
  body?: unknown,
  headers: HeadersInit = {},
  environment = env,
) {
  const requestHeaders = new Headers(headers);
  if (body !== undefined && !(body instanceof FormData))
    requestHeaders.set("Content-Type", "application/json");
  const data =
    body === undefined
      ? undefined
      : body instanceof FormData
        ? body
        : JSON.stringify(body);
  // Exercise the preserved legacy handler in isolation. The production app
  // retires this mount; these tests still verify stored provenance/credentials.
  if (path.startsWith("/api/connectors/webhooks/"))
    return legacyWebhooks.fetch(
      new Request(
        `http://localhost${path.replace("/api/connectors/webhooks", "")}`,
        { method, headers: requestHeaders, body: data },
      ),
      environment,
    );
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: requestHeaders,
      body: data,
    }),
    environment,
  );
}

async function create(
  title = "Synthetic connector record",
  extra: Record<string, unknown> = {},
): Promise<WorkRecord> {
  const response = await request("/api/records", "POST", {
    kind: "note",
    title,
    body: "Authored private content",
    ...extra,
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { record: WorkRecord }).record;
}

async function seedConnection(
  provider: "notion" | "github" | "leetcode" | "overleaf",
  config: Record<string, unknown>,
  credentials?: {
    token?: string;
    refreshToken?: string;
    installationId?: string;
  },
) {
  const account =
    provider === "notion"
      ? "synthetic-workspace"
      : provider === "github"
        ? "synthetic-github"
        : provider === "leetcode"
          ? String(config.username ?? "solver")
          : String(config.projectUrl ?? "synthetic-project");
  return saveConnection(
    env,
    owner,
    provider,
    account,
    `Synthetic ${provider}`,
    config,
    credentials,
  );
}

async function seedConnectionForOwner(
  connectionOwner: string,
  provider: "notion" | "github" | "leetcode" | "overleaf",
  accountId: string,
  config: Record<string, unknown>,
  credentials?: {
    token?: string;
    refreshToken?: string;
    installationId?: string;
  },
) {
  return saveConnection(
    env,
    connectionOwner,
    provider,
    accountId,
    `Synthetic ${provider}`,
    config,
    credentials,
  );
}

function json(
  payload: unknown,
  status = 200,
  contentType = "application/json",
) {
  return new Response(
    contentType.includes("json") ? JSON.stringify(payload) : String(payload),
    { status, headers: { "Content-Type": contentType } },
  );
}

async function notionSignature(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
  );
  return `sha256=${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

const PAGE_ID = "12345678-1234-4234-8234-123456789abc";
const NOTION_SELECTION = {
  id: PAGE_ID,
  title: "Synthetic Notion page",
  url: `https://www.notion.so/${PAGE_ID.replace(/-/g, "")}`,
};

function notionResponse(status = 200, markdown = "# Current Notion content") {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith(`/v1/pages/${PAGE_ID}/markdown`))
      return status === 200
        ? json({ markdown })
        : json({ message: "synthetic unavailable" }, status);
    if (url.endsWith(`/v1/pages/${PAGE_ID}`))
      return status === 200
        ? json({
            object: "page",
            id: PAGE_ID,
            url: NOTION_SELECTION.url,
            last_edited_time: "2026-09-18T12:00:00.000Z",
            properties: {
              Name: {
                type: "title",
                title: [{ plain_text: "Synthetic Notion page" }],
              },
            },
          })
        : json({ message: "synthetic unavailable" }, status);
    throw new Error(`Unexpected synthetic fetch: ${url}`);
  });
}

async function syncNotion(recordId?: string) {
  await seedConnection(
    "notion",
    {
      mode: "internal",
      selections: [{ ...NOTION_SELECTION, ...(recordId ? { recordId } : {}) }],
    },
    { token: "synthetic-notion-token-long-enough" },
  );
  return syncConnection(env, owner, "notion");
}

beforeAll(async () => {
  miniflare = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default { fetch() { return new Response("test"); } };',
      compatibilityDate: "2026-10-01",
      d1Databases: ["DB"],
      r2Buckets: ["FILES"],
    }),
  );
  env = {
    DB: (await miniflare.getD1Database("DB")) as unknown as D1Database,
    FILES: (await miniflare.getR2Bucket("FILES")) as unknown as R2Bucket,
    ENVIRONMENT: "local",
    LOCAL_DEV_AUTH: "true",
    OWNER_GITHUB_LOGIN: "synthetic-owner",
    APP_ORIGIN: "http://localhost",
    CONNECTOR_ENCRYPTION_KEY: "synthetic-connector-encryption-key-32",
  };
  await env.DB.exec(migration.replace(/--[^\n]*/g, "").replace(/\n/g, " "));
}, 30_000);

afterAll(async () => {
  await miniflare?.dispose();
}, 30_000);

afterEach(() => vi.unstubAllGlobals());

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM user").run();
  await env.DB.prepare("DELETE FROM rate_limits").run();
  await env.DB.prepare("DELETE FROM write_guards").run();
  const session = (await (await request("/api/session")).json()) as {
    user: { id: string };
  };
  owner = session.user.id;
});

describe("connector integration boundaries", () => {
  it("keeps a public GitHub connection stable when the account login changes", async () => {
    let login = "original-login";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ id: 12345, login })),
    );
    const first = await request("/api/connectors/github/connect", "POST", {
      username: login,
    });
    expect(first.status).toBe(201);
    const before = (await first.json()) as {
      connection: { id: string; accountId: string };
    };
    login = "renamed-login";
    const second = await request("/api/connectors/github/connect", "POST", {
      username: login,
    });
    expect(second.status).toBe(201);
    const after = (await second.json()) as {
      connection: { id: string; accountId: string };
    };
    expect(after.connection.id).toBe(before.connection.id);
    expect(after.connection.accountId).toBe("12345");
  });

  it("removes local credentials and webhook setup even after an encryption-key rotation", async () => {
    await seedConnection(
      "notion",
      { mode: "internal", selections: [] },
      { token: "synthetic-private-notion-token" },
    );
    const setup = await request("/api/connectors/notion/webhook-setup", "POST");
    expect(setup.status).toBe(201);
    const response = await request(
      "/api/connectors/notion",
      "DELETE",
      { retention: "keep" },
      {},
      {
        ...env,
        CONNECTOR_ENCRYPTION_KEY: "synthetic-rotated-connector-key-32",
      },
    );
    expect(response.status).toBe(200);
    expect(((await response.json()) as { warning: string }).warning).toContain(
      "provider settings",
    );
    const saved = await env.DB.prepare(
      "SELECT credential,status FROM connector_connections WHERE owner_id=? AND provider='notion'",
    )
      .bind(owner)
      .first<{ credential: string | null; status: string }>();
    expect(saved).toMatchObject({ credential: null, status: "disconnected" });
    expect(
      await env.DB.prepare(
        "SELECT id FROM connector_webhook_subscriptions WHERE owner_id=?",
      )
        .bind(owner)
        .first(),
    ).toBeNull();
  });
  it("requires a signed-in owner and rejects mapping a foreign Overleaf résumé", async () => {
    const signedOut = await request(
      "/api/connectors",
      "GET",
      undefined,
      {},
      { ...env, LOCAL_DEV_AUTH: "false" },
    );
    expect(signedOut.status).toBe(401);

    const timestamp = Date.now();
    await env.DB.prepare(
      "INSERT INTO user(id,name,email,email_verified,created_at,updated_at,github_id,github_login) VALUES(?,?,?,?,?,?,?,?)",
    )
      .bind(
        "foreign-owner",
        "Foreign",
        "foreign@example.invalid",
        1,
        timestamp,
        timestamp,
        "foreign-id",
        "foreign",
      )
      .run();
    const foreignAsset = newRecord({
      kind: "asset",
      title: "Foreign résumé",
      data: { type: "resume" },
    });
    await writeRecord(env.DB, "foreign-owner", foreignAsset);
    const response = await request("/api/connectors/overleaf/connect", "POST", {
      projectUrl: "https://www.overleaf.com/project/abcdef0123456789abcdef01",
      assetId: foreignAsset.id,
    });
    expect(response.status).toBe(404);
    const ownConnections = await request("/api/connectors");
    expect(
      ((await ownConnections.json()) as { connections: unknown[] }).connections,
    ).toEqual([]);
  });

  it("binds Notion OAuth state to the signed-in session and consumes it once", async () => {
    const previousClientId = env.NOTION_CLIENT_ID;
    const previousClientSecret = env.NOTION_CLIENT_SECRET;
    env.NOTION_CLIENT_ID = "synthetic-notion-client";
    env.NOTION_CLIENT_SECRET = "synthetic-notion-client-secret";
    try {
      const authorize = await request(
        "/api/connectors/notion/authorize",
        "POST",
        {},
      );
      expect(authorize.status).toBe(200);
      const { url } = (await authorize.json()) as { url: string };
      const state = new URL(url).searchParams.get("state");
      expect(state).toBeTruthy();

      const callbackPath = `/api/connectors/callback/notion?state=${encodeURIComponent(state!)}&error=access_denied`;
      const signedOut = await request(
        callbackPath,
        "GET",
        undefined,
        {},
        { ...env, LOCAL_DEV_AUTH: "false" },
      );
      expect(signedOut.status).toBe(401);

      const first = await request(callbackPath);
      expect(first.status).toBe(302);
      expect(decodeURIComponent(first.headers.get("Location") ?? "")).toContain(
        "Connection cancelled",
      );
      const replay = await request(callbackPath);
      expect(replay.status).toBe(302);
      expect(
        decodeURIComponent(replay.headers.get("Location") ?? ""),
      ).toContain("request expired");
    } finally {
      if (previousClientId === undefined) delete env.NOTION_CLIENT_ID;
      else env.NOTION_CLIENT_ID = previousClientId;
      if (previousClientSecret === undefined) delete env.NOTION_CLIENT_SECRET;
      else env.NOTION_CLIENT_SECRET = previousClientSecret;
    }
  });

  it("rejects tampered Notion webhook signatures and treats a retried delivery as duplicate", async () => {
    await seedConnection(
      "notion",
      { mode: "internal", selections: [] },
      { token: "synthetic-notion-token-long-enough" },
    );
    const setup = await request(
      "/api/connectors/notion/webhook-setup",
      "POST",
      {},
    );
    expect(setup.status).toBe(201);
    const subscription = (await setup.json()) as { id: string };
    const path = `/api/connectors/webhooks/notion/${subscription.id}`;
    const verificationToken = "synthetic-webhook-verification-token";
    const verified = await request(path, "POST", {
      verification_token: verificationToken,
    });
    expect(verified.status).toBe(200);
    const verification = await request(
      `/api/connectors/notion/webhook-setup/${subscription.id}`,
    );
    expect(
      ((await verification.json()) as { verificationToken: string })
        .verificationToken,
    ).toBe(verificationToken);

    const payload = JSON.stringify({
      id: "synthetic-delivery-1",
      workspace_id: "synthetic-workspace",
      type: "page.updated",
    });
    const signature = await notionSignature(verificationToken, payload);
    const tamperedSignature = `${signature.slice(0, -1)}${signature.endsWith("0") ? "1" : "0"}`;
    const bad = await request(path, "POST", JSON.parse(payload), {
      "X-Notion-Signature": tamperedSignature,
    });
    expect(bad.status).toBe(403);

    const first = await request(path, "POST", JSON.parse(payload), {
      "X-Notion-Signature": signature,
    });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ received: true });
    const retry = await request(path, "POST", JSON.parse(payload), {
      "X-Notion-Signature": signature,
    });
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({
      received: true,
      duplicate: true,
    });
  });

  it("rejects forged connector source metadata on native record creation", async () => {
    const response = await request("/api/records", "POST", {
      kind: "project",
      title: "Forged mapping",
      data: {
        connectorSource: {
          id: "forged-source",
          provider: "github",
          url: "https://github.com/example/project",
          available: true,
        },
      },
    });
    expect(response.status).toBe(400);
    expect(
      ((await (await request("/api/records")).json()) as { records: unknown[] })
        .records,
    ).toEqual([]);
  });

  it("syncs public LeetCode snapshots and keeps repeated accepted submissions idempotent", async () => {
    const payload = {
      data: {
        matchedUser: {
          username: "solver",
          profile: { ranking: 42 },
          submitStats: {
            acSubmissionNum: [
              { difficulty: "All", count: 12 },
              { difficulty: "Easy", count: 5 },
              { difficulty: "Medium", count: 6 },
              { difficulty: "Hard", count: 1 },
            ],
          },
          userCalendar: {
            submissionCalendar: JSON.stringify({ "1790000000": 2 }),
          },
        },
        allQuestionsCount: [
          { difficulty: "All", count: 3200 },
          { difficulty: "Easy", count: 900 },
          { difficulty: "Medium", count: 1600 },
          { difficulty: "Hard", count: 700 },
        ],
        recentAcSubmissionList: [
          {
            id: "90001",
            title: "Two Sum",
            titleSlug: "two-sum",
            timestamp: "1790000000",
          },
          {
            id: "90002",
            title: "Valid Parentheses",
            titleSlug: "valid-parentheses",
            timestamp: "1790000050",
          },
        ],
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(payload)),
    );

    const connected = await request(
      "/api/connectors/leetcode/connect",
      "POST",
      {
        username: "solver",
      },
    );
    expect(connected.status).toBe(201);
    await syncConnection(env, owner, "leetcode");

    const connection = (
      (await (await request("/api/connectors")).json()) as {
        connections: Array<{ provider: string; snapshot: unknown }>;
      }
    ).connections.find((item) => item.provider === "leetcode");
    expect(connection?.snapshot).toMatchObject({
      solved: { All: 12, Easy: 5, Medium: 6, Hard: 1 },
      calendar: { "1790000000": 2 },
    });
    const activityResponse = await request(
      "/api/connectors/activity?provider=leetcode&limit=20",
    );
    const activity = (
      (await activityResponse.json()) as { activities: ExternalActivity[] }
    ).activities;
    expect(activity).toHaveLength(2);
    expect(activity.map((item) => item.sourceKey)).toEqual(
      expect.arrayContaining(["solver:solver:90001", "solver:solver:90002"]),
    );
    const records = (
      (await (await request("/api/records")).json()) as {
        records: WorkRecord[];
      }
    ).records;
    expect(records.filter((item) => item.kind === "practice")).toEqual([]);
  });

  it("keeps mapped project title, notes, and milestones while GitHub source facts refresh", async () => {
    const project = await create("My authored project", {
      kind: "project",
      body: "My work notes stay here.",
      data: {
        status: "Active",
        milestones: [{ id: "m1", text: "Ship it", done: true }],
      },
    });
    let updatedAt = "2026-09-18T12:00:00.000Z";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/users/octocat"))
          return json({ id: 99, login: "octocat" });
        if (url.includes("/users/octocat/repos")) return json([]);
        if (url.endsWith("/repositories/123"))
          return json({
            id: 123,
            name: "demo",
            full_name: "octocat/demo",
            html_url: "https://github.com/octocat/demo",
            updated_at: updatedAt,
            description: "Synthetic source description",
            default_branch: "main",
            language: "TypeScript",
            topics: ["work"],
            archived: false,
          });
        if (url.endsWith("/repos/octocat/demo/readme"))
          return json("# Synthetic README", 200, "text/plain");
        throw new Error(`Unexpected synthetic fetch: ${url}`);
      }),
    );

    expect(
      (
        await request("/api/connectors/github/connect", "POST", {
          username: "octocat",
        })
      ).status,
    ).toBe(201);
    const selected = await request("/api/connectors/github/selection", "PUT", {
      selections: [
        {
          id: "123",
          title: "demo",
          url: "https://github.com/octocat/demo",
          recordId: project.id,
        },
      ],
    });
    expect(selected.status).toBe(200);
    updatedAt = "2026-09-19T12:00:00.000Z";
    await syncConnection(env, owner, "github");

    const saved = (
      (await (await request(`/api/records/${project.id}`)).json()) as {
        record: WorkRecord;
      }
    ).record;
    expect(saved).toMatchObject({
      title: "My authored project",
      body: "My work notes stay here.",
      data: {
        status: "Active",
        milestones: [{ id: "m1", text: "Ship it", done: true }],
        sourceName: "demo",
        sourceDescription: "Synthetic source description",
      },
    });
    expect(recordSource(saved)?.provider).toBe("github");
  });

  it("makes synced Notion content read-only while allowing annotation-only edits", async () => {
    const authored = await create("Authored note");
    vi.stubGlobal("fetch", notionResponse());
    await syncNotion(authored.id);
    const synced = (
      (await (await request(`/api/records/${authored.id}`)).json()) as {
        record: WorkRecord;
      }
    ).record;
    expect(synced.title).toBe("Synthetic Notion page");
    expect(synced.body).toContain("Current Notion content");
    expect(synced.data.annotation).toBe("Authored private content");

    expect(
      (
        await request(`/api/records/${synced.id}`, "PATCH", {
          title: "Changed title",
          version: synced.version,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(`/api/records/${synced.id}`, "PATCH", {
          body: "Changed body",
          version: synced.version,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(`/api/records/${synced.id}`, "PATCH", {
          data: {
            ...synced.data,
            connectorSource: {
              ...recordSource(synced),
              url: "https://example.invalid/forged",
            },
            annotation: "changed",
          },
          version: synced.version,
        })
      ).status,
    ).toBe(409);

    const annotation = await request(`/api/records/${synced.id}`, "PATCH", {
      data: { ...synced.data, annotation: "My independent Work context" },
      version: synced.version,
    });
    expect(annotation.status).toBe(200);
    const edited = ((await annotation.json()) as { record: WorkRecord }).record;
    expect(edited.data.annotation).toBe("My independent Work context");
    expect(recordSource(edited)).toEqual(recordSource(synced));
    expect(edited.body).toBe(synced.body);
  });

  it.each([403, 404])(
    "hides a Notion source after access returns %i",
    async (status) => {
      const note = await create("Private source note");
      vi.stubGlobal("fetch", notionResponse());
      await syncNotion(note.id);
      const synced = (
        (await (await request(`/api/records/${note.id}`)).json()) as {
          record: WorkRecord;
        }
      ).record;
      const form = new FormData();
      form.set(
        "file",
        new File(["%PDF-1.7\nsynthetic private attachment"], "private.pdf", {
          type: "application/pdf",
        }),
      );
      const uploaded = await request(
        `/api/records/${note.id}/attachments`,
        "POST",
        form,
      );
      expect(uploaded.status).toBe(201);
      vi.stubGlobal("fetch", notionResponse(status));
      await syncConnection(env, owner, "notion");

      expect((await request(`/api/records/${note.id}`)).status).toBe(404);
      expect((await request(`/api/records/${note.id}/revisions`)).status).toBe(
        404,
      );
      expect(
        (await request(`/api/records/${note.id}/attachments`)).status,
      ).toBe(404);
      const attachment = (
        (await uploaded.json()) as { attachment: { id: string } }
      ).attachment;
      expect((await request(`/api/attachments/${attachment.id}`)).status).toBe(
        404,
      );
      const visibleRecords = await request("/api/records");
      expect(
        ((await visibleRecords.json()) as { records: unknown[] }).records,
      ).toEqual([]);
      expect(
        (
          (await (
            await request("/api/search?q=Synthetic%20Notion%20page")
          ).json()) as {
            records: WorkRecord[];
          }
        ).records,
      ).toEqual([]);
      expect(synced.body).toContain("Current Notion content");
    },
  );

  it("preserves the last successful Notion content when the provider returns 502", async () => {
    const note = await create("Cached source note");
    vi.stubGlobal("fetch", notionResponse());
    await syncNotion(note.id);
    const before = (
      (await (await request(`/api/records/${note.id}`)).json()) as {
        record: WorkRecord;
      }
    ).record;
    vi.stubGlobal("fetch", notionResponse(502));
    const retry = await syncConnection(env, owner, "notion");
    expect(retry.connection.status).toBe("attention");
    const after = (
      (await (await request(`/api/records/${note.id}`)).json()) as {
        record: WorkRecord;
      }
    ).record;
    expect(after.body).toBe(before.body);
    expect(after.title).toBe(before.title);
    expect(recordSource(after)?.available).toBe(true);
  });

  it("keeps the submitted PDF snapshot unchanged across Overleaf linking and refresh", async () => {
    const asset = await create("Submitted résumé", {
      kind: "asset",
      data: { type: "resume" },
    });
    const form = new FormData();
    form.set(
      "file",
      new File(["%PDF-1.7\nsynthetic submitted PDF"], "resume.pdf", {
        type: "application/pdf",
      }),
    );
    const upload = await request(
      `/api/records/${asset.id}/attachments`,
      "POST",
      form,
    );
    const attachment = ((await upload.json()) as { attachment: { id: string } })
      .attachment;
    const application = await create("Submitted application", {
      kind: "application",
      links: [asset.id],
      data: {
        stage: "Applied",
        assetVersions: [
          {
            assetId: asset.id,
            attachmentId: attachment.id,
            version: 1,
            body: "Submitted PDF snapshot",
          },
        ],
      },
    });
    const connect = await request("/api/connectors/overleaf/connect", "POST", {
      projectUrl: "https://www.overleaf.com/project/abcdef0123456789abcdef01",
      assetId: asset.id,
    });
    expect(connect.status).toBe(201);
    expect(
      (await request("/api/connectors/overleaf/refresh", "POST")).status,
    ).toBe(200);
    const savedApplication = (
      (await (await request(`/api/records/${application.id}`)).json()) as {
        record: WorkRecord;
      }
    ).record;
    expect(savedApplication.data.assetVersions).toEqual(
      application.data.assetVersions,
    );
    expect((await request(`/api/attachments/${attachment.id}`)).status).toBe(
      200,
    );
  });

  it("retains mapped source data on disconnect, pauses safely, and deletes credentials", async () => {
    const note = await create("Notion record to retain");
    vi.stubGlobal("fetch", notionResponse());
    await syncNotion(note.id);
    const pause = await request("/api/connectors/notion", "PATCH", {
      paused: true,
    });
    expect(pause.status).toBe(200);
    expect(
      ((await pause.json()) as { connection: { status: string } }).connection
        .status,
    ).toBe("paused");
    const disconnected = await request("/api/connectors/notion", "DELETE", {
      retention: "keep",
    });
    expect(disconnected.status).toBe(200);
    expect(
      ((await disconnected.json()) as { connection: { status: string } })
        .connection.status,
    ).toBe("disconnected");
    const saved = (
      (await (await request(`/api/records/${note.id}`)).json()) as {
        record: WorkRecord;
      }
    ).record;
    expect(saved.body).toContain("Current Notion content");
    expect(recordSource(saved)).toMatchObject({
      detached: true,
      available: true,
    });
    const row = await env.DB.prepare(
      "SELECT credential FROM connector_connections WHERE owner_id=? AND provider='notion'",
    )
      .bind(owner)
      .first<{ credential: string | null }>();
    expect(row?.credential).toBeNull();
  });

  it("exports connector provenance and activity without credentials, then restores safely for a new owner", async () => {
    const note = await create("Backup Notion source");
    const providerToken = "synthetic-notion-provider-secret";
    const webhookToken = "synthetic-notion-webhook-verification-secret";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("leetcode.com/graphql"))
          return json({
            data: {
              matchedUser: {
                username: "solver",
                profile: { ranking: 9 },
                submitStats: {
                  acSubmissionNum: [{ difficulty: "All", count: 1 }],
                },
                userCalendar: { submissionCalendar: "{}" },
              },
              allQuestionsCount: [],
              recentAcSubmissionList: [
                {
                  id: "91001",
                  title: "Backup solve",
                  titleSlug: "backup-solve",
                  timestamp: "1790000000",
                },
              ],
            },
          });
        if (url.endsWith(`/v1/pages/${PAGE_ID}/markdown`))
          return json({ markdown: "# Backed up Notion content" });
        if (url.endsWith(`/v1/pages/${PAGE_ID}`))
          return json({
            object: "page",
            id: PAGE_ID,
            url: NOTION_SELECTION.url,
            last_edited_time: "2026-09-18T12:00:00.000Z",
            properties: {
              Name: {
                type: "title",
                title: [{ plain_text: "Backup Notion source" }],
              },
            },
          });
        throw new Error(`Unexpected synthetic fetch: ${url}`);
      }),
    );
    await seedConnection(
      "notion",
      {
        mode: "internal",
        selections: [{ ...NOTION_SELECTION, recordId: note.id }],
      },
      { token: providerToken },
    );
    await syncConnection(env, owner, "notion");
    expect(
      (
        await request("/api/connectors/leetcode/connect", "POST", {
          username: "solver",
        })
      ).status,
    ).toBe(201);
    const webhookSetup = await request(
      "/api/connectors/notion/webhook-setup",
      "POST",
      {},
    );
    const subscription = (await webhookSetup.json()) as { id: string };
    expect(webhookSetup.status).toBe(201);
    expect(
      (
        await request(
          `/api/connectors/webhooks/notion/${subscription.id}`,
          "POST",
          {
            verification_token: webhookToken,
          },
        )
      ).status,
    ).toBe(200);

    const backup = await exportWorkspace(env, owner, false);
    const archiveText = JSON.stringify(backup);
    const notionConnection = backup.connectors?.connections.find(
      (item) => item.provider === "notion",
    );
    const leetcodeConnection = backup.connectors?.connections.find(
      (item) => item.provider === "leetcode",
    );
    expect(notionConnection).toBeDefined();
    expect(leetcodeConnection).toBeDefined();
    expect(
      backup.connectors?.sources.some((source) => source.recordId === note.id),
    ).toBe(true);
    expect(
      backup.connectors?.activities.some(
        (activity) =>
          activity.provider === "leetcode" && activity.title === "Backup solve",
      ),
    ).toBe(true);
    expect(archiveText).toContain("connectorSource");
    expect(archiveText).not.toContain(providerToken);
    expect(archiveText).not.toContain(webhookToken);
    const credentialRows = await env.DB.prepare(
      "SELECT credential FROM connector_connections WHERE owner_id=? AND provider='notion'",
    )
      .bind(owner)
      .first<{ credential: string | null }>();
    const webhookRow = await env.DB.prepare(
      "SELECT credential FROM connector_webhook_subscriptions WHERE id=?",
    )
      .bind(subscription.id)
      .first<{ credential: string | null }>();
    expect(credentialRows?.credential).toBeTruthy();
    expect(webhookRow?.credential).toBeTruthy();
    expect(archiveText).not.toContain(credentialRows!.credential!);
    expect(archiveText).not.toContain(webhookRow!.credential!);

    const restoredOwner = "restored-synthetic-owner";
    const timestamp = Date.now();
    await env.DB.prepare(
      "INSERT INTO user(id,name,email,email_verified,created_at,updated_at,github_id,github_login) VALUES(?,?,?,?,?,?,?,?)",
    )
      .bind(
        restoredOwner,
        "Restored",
        "restored@example.invalid",
        0,
        timestamp,
        timestamp,
        "restored",
        "restored",
      )
      .run();
    const restored = (await restoreWorkspace(env, restoredOwner, backup)) as {
      restored: number;
      records: WorkRecord[];
    };
    expect(restored.restored).toBe(backup.records.length);
    const restoredConnections = await env.DB.prepare(
      "SELECT provider,status,credential FROM connector_connections WHERE owner_id=? ORDER BY provider",
    )
      .bind(restoredOwner)
      .all<{ provider: string; status: string; credential: string | null }>();
    expect(restoredConnections.results).toHaveLength(2);
    expect(
      restoredConnections.results.every(
        (row) => row.status === "disconnected" && row.credential === null,
      ),
    ).toBe(true);
    const restoredNote = restored.records.find(
      (record) => record.kind === "note",
    )!;
    expect(recordSource(restoredNote)).toMatchObject({
      provider: "notion",
      detached: true,
    });
    expect(restoredNote.body).toContain("Backed up Notion content");

    await seedConnectionForOwner(
      restoredOwner,
      "notion",
      notionConnection!.accountId,
      notionConnection!.config,
      { token: "synthetic-notion-reconnected-token" },
    );
    await syncConnection(env, restoredOwner, "notion");
    const restoredNoteRows = await env.DB.prepare(
      "SELECT id FROM records WHERE owner_id=? AND kind='note'",
    )
      .bind(restoredOwner)
      .all<{ id: string }>();
    const mappedSource = await env.DB.prepare(
      "SELECT record_id FROM connector_sources WHERE owner_id=? AND provider='notion' AND source_id=?",
    )
      .bind(restoredOwner, PAGE_ID)
      .first<{ record_id: string }>();
    expect(restoredNoteRows.results).toHaveLength(1);
    expect(mappedSource?.record_id).toBe(restoredNote.id);
    const sources = await env.DB.prepare(
      "SELECT count(*) AS count FROM connector_sources WHERE owner_id=? AND provider='notion' AND account_id=? AND source_id=?",
    )
      .bind(restoredOwner, notionConnection!.accountId, PAGE_ID)
      .first<{ count: number }>();
    expect(sources?.count).toBe(1);
  });

  it("copies synced Notion attachments to private Work files and leaves the copy unchanged on later sync", async () => {
    const note = await create("Notion page with attachment");
    const mediaUrl =
      "https://files.notionusercontent.com/synthetic-document.pdf";
    const pdf = new TextEncoder().encode(
      "%PDF-1.7\nSynthetic private source PDF",
    );
    let sourceMarkdown = `<pdf name="source.pdf" url="${mediaUrl}" />\n\n# Original synced note`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === mediaUrl)
          return new Response(pdf, {
            headers: { "Content-Type": "application/pdf" },
          });
        if (url.endsWith(`/v1/pages/${PAGE_ID}/markdown`))
          return json({ markdown: sourceMarkdown });
        if (url.endsWith(`/v1/pages/${PAGE_ID}`))
          return json({
            object: "page",
            id: PAGE_ID,
            url: NOTION_SELECTION.url,
            last_edited_time: "2026-09-18T12:00:00.000Z",
            properties: {
              Name: {
                type: "title",
                title: [{ plain_text: "Notion page with attachment" }],
              },
            },
          });
        throw new Error(`Unexpected synthetic fetch: ${url}`);
      }),
    );
    await syncNotion(note.id);
    const original = (
      (await (await request(`/api/records/${note.id}`)).json()) as {
        record: WorkRecord;
      }
    ).record;
    const sourceAttachmentId = original.body.match(
      /\/api\/attachments\/([a-zA-Z0-9-]+)/,
    )?.[1];
    expect(sourceAttachmentId).toBeTruthy();
    expect(
      (await request(`/api/attachments/${sourceAttachmentId}`)).status,
    ).toBe(200);

    const copiedResponse = await request(
      "/api/connectors/notion/copy",
      "POST",
      { recordId: note.id },
    );
    expect(copiedResponse.status).toBe(201);
    const copy = ((await copiedResponse.json()) as { record: WorkRecord })
      .record;
    const copyAttachmentId = copy.body.match(
      /\/api\/attachments\/([a-zA-Z0-9-]+)/,
    )?.[1];
    expect(copyAttachmentId).toBeTruthy();
    expect(copyAttachmentId).not.toBe(sourceAttachmentId);
    expect(copy.body).toContain(`/api/attachments/${copyAttachmentId}`);
    const copiedPdf = await request(`/api/attachments/${copyAttachmentId}`);
    expect(copiedPdf.status).toBe(200);
    expect(new TextDecoder().decode(await copiedPdf.arrayBuffer())).toBe(
      new TextDecoder().decode(pdf),
    );

    sourceMarkdown = `<pdf name="source.pdf" url="${mediaUrl}" />\n\n# Updated source content`;
    await syncConnection(env, owner, "notion");
    const sourceAfter = (
      (await (await request(`/api/records/${note.id}`)).json()) as {
        record: WorkRecord;
      }
    ).record;
    const copyAfter = (
      (await (await request(`/api/records/${copy.id}`)).json()) as {
        record: WorkRecord;
      }
    ).record;
    expect(sourceAfter.body).toContain("Updated source content");
    expect(copyAfter.body).toBe(copy.body);
    expect((await request(`/api/attachments/${copyAttachmentId}`)).status).toBe(
      200,
    );
  });

  it("removes synced Notion body, media, and historical content while keeping Work annotations", async () => {
    const note = await create("Notion source to remove");
    const mediaUrl = "https://files.notionusercontent.com/remove-me.pdf";
    const pdf = new TextEncoder().encode(
      "%PDF-1.7\nSynthetic removable content",
    );
    let sourceMarkdown = `<pdf name="remove.pdf" url="${mediaUrl}" />\n\n# Private source text`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === mediaUrl)
          return new Response(pdf, {
            headers: { "Content-Type": "application/pdf" },
          });
        if (url.endsWith(`/v1/pages/${PAGE_ID}/markdown`))
          return json({ markdown: sourceMarkdown });
        if (url.endsWith(`/v1/pages/${PAGE_ID}`))
          return json({
            object: "page",
            id: PAGE_ID,
            url: NOTION_SELECTION.url,
            last_edited_time: "2026-09-18T12:00:00.000Z",
            properties: {
              Name: {
                type: "title",
                title: [{ plain_text: "Notion source to remove" }],
              },
            },
          });
        throw new Error(`Unexpected synthetic fetch: ${url}`);
      }),
    );
    await syncNotion(note.id);
    let synced = (
      (await (await request(`/api/records/${note.id}`)).json()) as {
        record: WorkRecord;
      }
    ).record;
    const attachmentId = synced.body.match(
      /\/api\/attachments\/([a-zA-Z0-9-]+)/,
    )?.[1];
    expect(attachmentId).toBeTruthy();
    const annotationPatch = await request(`/api/records/${note.id}`, "PATCH", {
      data: { ...synced.data, annotation: "My retained Work annotation" },
      version: synced.version,
    });
    expect(annotationPatch.status).toBe(200);
    sourceMarkdown = `<pdf name="remove.pdf" url="${mediaUrl}" />\n\n# Updated private source text`;
    await syncConnection(env, owner, "notion");
    synced = (
      (await (await request(`/api/records/${note.id}`)).json()) as {
        record: WorkRecord;
      }
    ).record;

    const disconnect = await request("/api/connectors/notion", "DELETE", {
      retention: "remove",
    });
    expect(disconnect.status).toBe(200);
    const retained = (
      (await (await request(`/api/records/${note.id}`)).json()) as {
        record: WorkRecord;
      }
    ).record;
    expect(retained.body).toBe("");
    expect(retained.data.annotation).toBe("My retained Work annotation");
    expect(retained.data.sourceWarnings).toBeUndefined();
    expect(recordSource(retained)).toBeNull();
    expect((await request(`/api/attachments/${attachmentId}`)).status).toBe(
      404,
    );
    const revisions = (
      (await (await request(`/api/records/${note.id}/revisions`)).json()) as {
        revisions: Array<{ body: string }>;
      }
    ).revisions;
    expect(revisions.length).toBeGreaterThan(0);
    expect(revisions.every((revision) => revision.body === "")).toBe(true);
    const deletedFile = await env.DB.prepare(
      "SELECT id FROM attachments WHERE id=?",
    )
      .bind(attachmentId)
      .first();
    expect(deletedFile).toBeNull();
    expect(synced.data.annotation).toBe("My retained Work annotation");
  });

  it("holds a sync lease and rejects selection changes until the current run ends", async () => {
    await seedConnection(
      "notion",
      {
        mode: "internal",
        selections: [NOTION_SELECTION],
      },
      { token: "synthetic-notion-token-long-enough" },
    );
    let releasePage!: (response: Response) => void;
    let pageRequested!: () => void;
    const requested = new Promise<void>((resolve) => {
      pageRequested = resolve;
    });
    const firstPage = new Promise<Response>((resolve) => {
      releasePage = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith(`/v1/pages/${PAGE_ID}`)) {
          pageRequested();
          return firstPage;
        }
        if (url.endsWith(`/v1/pages/${PAGE_ID}/markdown`))
          return json({ markdown: "# Completed after lease" });
        throw new Error(`Unexpected synthetic fetch: ${url}`);
      }),
    );
    const running = syncConnection(env, owner, "notion");
    await requested;
    const update = await request("/api/connectors/notion/selection", "PUT", {
      selections: [NOTION_SELECTION],
    });
    expect(update.status).toBe(409);
    releasePage(
      json({
        object: "page",
        id: PAGE_ID,
        url: NOTION_SELECTION.url,
        last_edited_time: "2026-09-18T12:00:00.000Z",
        properties: {
          Name: {
            type: "title",
            title: [{ plain_text: "Synthetic Notion page" }],
          },
        },
      }),
    );
    const finished = await running;
    expect(finished.connection.status).toBe("connected");
  });
});
