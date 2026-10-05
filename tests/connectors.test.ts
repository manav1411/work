import { readFileSync } from "node:fs";
import { CONNECTOR_PROVIDERS } from "../shared/connectors";
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
import { app } from "../worker";
import type { Env } from "../worker/env";
import { insertRecord, newRecord } from "../worker/db/records";
import { connectorBackupSchema } from "../worker/connectors/backup";
import type { Attachment, WorkRecord } from "../shared/model";
import type { WorkspaceExport } from "../worker/import-export";

let miniflare: Miniflare;
let env: Env;
const owner = "local-manav";
const at = "2026-10-01T00:00:00.000Z";
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  environment = env,
) {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers:
        body instanceof FormData
          ? { Origin: "http://localhost" }
          : body === undefined
            ? {}
            : {
                "Content-Type": "application/json",
                Origin: "http://localhost",
              },
      body:
        body === undefined
          ? undefined
          : body instanceof FormData
            ? body
            : JSON.stringify(body),
    }),
    environment,
  );
}
async function seedConnection(provider: string) {
  const id = `retired-${provider}`;
  await env.DB.prepare(
    "INSERT INTO connector_connections(id,owner_id,provider,account_id,label,status,config,snapshot,credential,created_at,last_success_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
  )
    .bind(
      id,
      owner,
      provider,
      `synthetic-${provider}`,
      `Legacy ${provider}`,
      "disconnected",
      JSON.stringify(
        provider === "leetcode"
          ? { username: "synthetic-solver" }
          : provider === "notion"
            ? { mode: "internal", selections: [] }
            : { mode: "public" },
      ),
      JSON.stringify({ historical: "Keep the old source snapshot" }),
      "synthetic-private-credential",
      at,
      at,
    )
    .run();
  return id;
}
async function snapshot() {
  const tables = [
    "user",
    "account",
    "records",
    "record_revisions",
    "connector_connections",
    "connector_sources",
    "connector_activity",
    "connector_runs",
    "connector_oauth_states",
    "connector_webhook_subscriptions",
    "connector_deliveries",
  ];
  const values: Record<string, unknown> = {};
  for (const table of tables)
    values[table] = (
      await env.DB.prepare(`SELECT * FROM ${table}`).all()
    ).results;
  return values;
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
  };
  const sql = [
    "0001_workspace.sql",
    "0002_submitted_files.sql",
    "0003_connectors.sql",
    "0004_simplification.sql",
    "0005_workspace_improvements.sql",
    "0006_backup_staging.sql",
    "0007_native_latex.sql",
  ]
    .map((file) =>
      readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"),
    )
    .join("\n");
  await env.DB.exec(sql.replace(/--[^\n]*/g, "").replace(/\n/g, " "));
}, 30_000);
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM user"),
    env.DB.prepare("DELETE FROM rate_limits"),
    env.DB.prepare("DELETE FROM write_guards"),
  ]);
  await request("/api/session");
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  await miniflare?.dispose();
}, 30_000);

const retiredActions: Array<[string, string]> = [
  ["/api/connectors", "GET"],
  ["/api/connectors/activity", "GET"],
  ["/api/connectors/suggestions", "GET"],
  ["/api/connectors/notion/connect", "POST"],
  ["/api/connectors/github/connect", "POST"],
  ["/api/connectors/leetcode/connect", "POST"],
  ["/api/connectors/overleaf/connect", "POST"],
  ["/api/connectors/notion/authorize", "POST"],
  ["/api/connectors/github/authorize", "POST"],
  ["/api/connectors/callback/notion?state=old-state&code=old-code", "GET"],
  ["/api/connectors/callback/github?state=old-state&code=old-code", "GET"],
  ["/api/connectors/notion/discover", "GET"],
  ["/api/connectors/notion/selection", "PUT"],
  ["/api/connectors/notion/map", "POST"],
  ["/api/connectors/notion/refresh", "POST"],
  ["/api/connectors/notion/sync", "POST"],
  ["/api/connectors/notion", "PATCH"],
  ["/api/connectors/notion", "DELETE"],
  ["/api/connectors/notion/copy", "POST"],
  ["/api/connectors/notion/webhook-setup", "POST"],
  ["/api/connectors/notion/webhook-setup/old-subscription", "GET"],
  ["/api/connectors/notion/runs", "GET"],
];
describe("retired connector integration boundaries", () => {
  it("requires the signed-in owner before private retired callbacks, setup and mutation routes", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    for (const [path, method] of retiredActions)
      expect(
        (
          await request(
            path,
            method,
            ["GET", "HEAD"].includes(method) ? undefined : {},
            { ...env, LOCAL_DEV_AUTH: "false" },
          )
        ).status,
      ).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("returns inert 410 responses without provider traffic, stored-state mutations or credential exposure", async () => {
    for (const provider of CONNECTOR_PROVIDERS) await seedConnection(provider);
    await env.DB.prepare(
      "INSERT INTO account(id,account_id,provider_id,user_id,access_token,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
    )
      .bind(
        "github-login",
        "synthetic-login",
        "github",
        owner,
        "synthetic-sign-in-token",
        1,
        1,
      )
      .run();
    await env.DB.prepare(
      "INSERT INTO connector_oauth_states(state_hash,owner_id,provider,session_hash,expires_at,created_at) VALUES(?,?,?,?,?,?)",
    )
      .bind("old-state", owner, "notion", "synthetic-session", at, at)
      .run();
    const before = await snapshot();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    for (const [path, method] of retiredActions) {
      const response = await request(
        path,
        method,
        ["GET", "HEAD"].includes(method)
          ? undefined
          : {
              token: "submitted-secret",
              selections: [],
              retention: "remove",
              paused: false,
            },
      );
      expect(response.status, `${method} ${path}`).toBe(410);
      const body = await response.text();
      expect(body).toContain("RETIRED");
      for (const secret of [
        "synthetic-private-credential",
        "synthetic-sign-in-token",
        "submitted-secret",
        "old-state",
        "old-code",
      ])
        expect(body).not.toContain(secret);
      expect(response.headers.get("Location")).toBeNull();
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(await snapshot()).toEqual(before);
    expect(await (await request("/api/session")).json()).toMatchObject({
      user: { id: owner },
    });
  });
  it("returns 410 for provider webhook deliveries before interpreting payloads and changes no source records", async () => {
    await seedConnection("notion");
    const before = await snapshot();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    for (const path of [
      "/api/connectors/webhooks/notion/old-subscription",
      "/api/connectors/webhooks/github/old-subscription",
      "/api/connectors/webhooks/notion/unknown",
    ]) {
      const response = await request(
        path,
        "POST",
        {
          verification_token: "synthetic-verification-secret",
          id: "replayed-delivery",
          type: "page.updated",
        },
        { ...env, LOCAL_DEV_AUTH: "false" },
      );
      expect(response.status).toBe(410);
      expect(await response.text()).not.toContain(
        "synthetic-verification-secret",
      );
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(await snapshot()).toEqual(before);
  });
  it("retains private imported files, authored revisions and provenance through backup while restored connections remain disconnected", async () => {
    const connectionId = await seedConnection("notion");
    await env.DB.prepare(
      "INSERT INTO account(id,account_id,provider_id,user_id,access_token,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
    )
      .bind(
        "github-login",
        "synthetic-login",
        "github",
        owner,
        "synthetic-sign-in-token",
        1,
        1,
      )
      .run();
    const note = newRecord({
      kind: "note",
      title: "Imported private knowledge",
      body: "# Original private note",
      data: {
        collection: "Imported notes",
        originalMarkdown: "# Original export",
        connectorSource: {
          id: "legacy-source",
          provider: "notion",
          url: "https://example.invalid/original",
          lastFetchedAt: at,
          sourceUpdatedAt: at,
          available: true,
          detached: true,
        },
      },
    });
    await insertRecord(env.DB, owner, note).run();
    await env.DB.prepare(
      "INSERT INTO connector_sources(id,owner_id,connection_id,provider,account_id,source_id,record_id,source_url,snapshot,content_hash,last_fetched_at,source_updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
    )
      .bind(
        "legacy-source",
        owner,
        connectionId,
        "notion",
        "synthetic-notion",
        "legacy-page",
        note.id,
        "https://example.invalid/original",
        JSON.stringify({ authored: "Source snapshot" }),
        "legacy-hash",
        at,
        at,
      )
      .run();
    const form = new FormData();
    form.set(
      "file",
      new File(["Synthetic private attachment"], "research.md", {
        type: "text/markdown",
      }),
    );
    const uploaded = await request(
      `/api/records/${note.id}/attachments`,
      "POST",
      form,
    );
    expect(uploaded.status).toBe(201);
    const file = ((await uploaded.json()) as { attachment: Attachment })
      .attachment;
    expect(
      (
        await request(`/api/records/${note.id}`, "PATCH", {
          version: note.version,
          body: `# My preserved annotation\n\n[Reading](/api/attachments/${file.id})`,
        })
      ).status,
    ).toBe(200);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const exported = await request("/api/export");
    expect(exported.status).toBe(200);
    const backup = (await exported.json()) as WorkspaceExport;
    expect(JSON.stringify(backup)).not.toContain(
      "synthetic-private-credential",
    );
    expect(JSON.stringify(backup)).not.toContain("synthetic-sign-in-token");
    expect(
      backup.revisions.some(
        (revision) =>
          revision.recordId === note.id && revision.body === note.body,
      ),
    ).toBe(true);
    expect(
      backup.records.find((record) => record.id === note.id)?.data,
    ).toMatchObject({
      originalMarkdown: "# Original export",
      connectorSource: { detached: true, provider: "notion" },
    });
    expect(
      backup.attachments.find((attachment) => attachment.id === file.id)
        ?.base64,
    ).toBe(btoa("Synthetic private attachment"));
    const restoredResponse = await request("/api/restore", "POST", backup);
    expect(restoredResponse.status).toBe(201);
    const restored = (await restoredResponse.json()) as {
      records: WorkRecord[];
    };
    const copy = restored.records.find(
      (record) => record.title === note.title,
    )!;
    expect(copy.id).not.toBe(note.id);
    expect(copy.body).toContain("My preserved annotation");
    expect(copy.data).toMatchObject({
      originalMarkdown: "# Original export",
      connectorSource: {
        detached: true,
        available: true,
        url: "https://example.invalid/original",
      },
    });
    const copies = (await (
      await request(`/api/records/${copy.id}/attachments`)
    ).json()) as { attachments: Attachment[] };
    expect(copies.attachments).toHaveLength(1);
    expect(
      await (
        await request(`/api/attachments/${copies.attachments[0].id}`)
      ).text(),
    ).toBe("Synthetic private attachment");
    const connection = await env.DB.prepare(
      "SELECT status,credential,next_sync_at FROM connector_connections WHERE owner_id=? AND provider='notion'",
    )
      .bind(owner)
      .first();
    expect(connection).toEqual({
      status: "disconnected",
      credential: null,
      next_sync_at: null,
    });
    expect(
      await env.DB.prepare(
        "SELECT access_token FROM account WHERE id='github-login'",
      ).first(),
    ).toEqual({ access_token: "synthetic-sign-in-token" });
    expect((await request(`/api/records/${note.id}`)).status).toBe(200);
    expect(
      (await request("/api/connectors/notion/refresh", "POST", {})).status,
    ).toBe(410);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("continues to validate legacy backup connector structures without accepting embedded credentials", () => {
    const valid = {
      connections: [
        {
          id: "old-connection",
          provider: "notion",
          accountId: "legacy-workspace",
          label: "Saved import",
          config: { mode: "internal", selections: [] },
          snapshot: { retained: true },
          createdAt: at,
          lastSuccessAt: at,
        },
      ],
      sources: [],
      activities: [],
    };
    expect(connectorBackupSchema.safeParse(valid).success).toBe(true);
    expect(
      connectorBackupSchema.safeParse({
        ...valid,
        connections: [{ ...valid.connections[0], credential: "secret" }],
      }).success,
    ).toBe(false);
    expect(
      connectorBackupSchema.safeParse({
        ...valid,
        connections: [{ ...valid.connections[0], config: { token: "secret" } }],
      }).success,
    ).toBe(false);
  });
});
