import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";

let miniflare: Miniflare;
let db: D1Database;
const migration = readFileSync(
  new URL("../migrations/0005_workspace_improvements.sql", import.meta.url),
  "utf8",
);
const sql = (value: string) =>
  value.replace(/--[^\n]*/g, "").replace(/\n/g, " ");
const timestamp = "2026-10-05T00:00:00.000Z";
async function owner(id: string) {
  await db
    .prepare(
      "INSERT INTO user(id,name,email,email_verified,created_at,updated_at,github_id,github_login) VALUES(?,?,?,?,?,?,?,?)",
    )
    .bind(
      id,
      `Synthetic ${id}`,
      `${id}@example.invalid`,
      1,
      1,
      1,
      `${id}-github`,
      `${id}-login`,
    )
    .run();
}
async function connection(
  id: string,
  user: string,
  provider: string,
  config: Record<string, unknown>,
) {
  await db
    .prepare(
      "INSERT INTO connector_connections(id,owner_id,provider,account_id,label,status,config,credential,generation,created_at,next_sync_at,lease_token,lease_until) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .bind(
      id,
      user,
      provider,
      `${provider}-account`,
      `Saved ${provider}`,
      "connected",
      JSON.stringify(config),
      "synthetic-encrypted-secret",
      4,
      timestamp,
      timestamp,
      "held-lease",
      timestamp,
    )
    .run();
}
async function savedRecord(
  id: string,
  user: string,
  kind: string,
  title: string,
  data: Record<string, unknown>,
  body = "Authored content",
) {
  await db
    .prepare(
      "INSERT INTO records(id,owner_id,kind,title,body,data,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
    )
    .bind(
      id,
      user,
      kind,
      title,
      body,
      JSON.stringify(data),
      timestamp,
      timestamp,
    )
    .run();
}
async function recordData(id: string) {
  const row = await db
    .prepare("SELECT data,body,version FROM records WHERE id=?")
    .bind(id)
    .first<{ data: string; body: string; version: number }>();
  return row
    ? { ...row, data: JSON.parse(row.data) as Record<string, unknown> }
    : undefined;
}
beforeAll(async () => {
  miniflare = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default { fetch() { return new Response("test"); } };',
      compatibilityDate: "2026-10-01",
      d1Databases: ["DB"],
    }),
  );
  db = (await miniflare.getD1Database("DB")) as unknown as D1Database;
  const initial = [
    "0001_workspace.sql",
    "0002_submitted_files.sql",
    "0003_connectors.sql",
    "0004_simplification.sql",
  ]
    .map((file) =>
      readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"),
    )
    .join("\n");
  await db.exec(sql(initial));
}, 30_000);
beforeEach(async () => {
  await db.prepare("DELETE FROM user").run();
});
afterAll(async () => {
  await miniflare?.dispose();
}, 30_000);

describe("workspace improvement additive migration", () => {
  it("copies only missing valid LeetCode identities, preserves saved preferences, and clears integration credentials without changing sign-in", async () => {
    for (const id of [
      "missing",
      "empty",
      "configured",
      "invalid",
      "long-valid",
    ])
      await owner(id);
    await db
      .prepare(
        "INSERT INTO preferences(owner_id,data,updated_at) VALUES(?,?,?)",
      )
      .bind(
        "empty",
        JSON.stringify({
          theme: "dark",
          leetcode: "",
          website: "https://example.invalid/me",
        }),
        timestamp,
      )
      .run();
    await db
      .prepare(
        "INSERT INTO preferences(owner_id,data,updated_at) VALUES(?,?,?)",
      )
      .bind(
        "configured",
        JSON.stringify({
          leetcode: "https://leetcode.com/u/my-chosen-handle/",
          timezone: "UTC",
          theme: "dark",
        }),
        timestamp,
      )
      .run();
    await connection("missing-lc", "missing", "leetcode", {
      username: "saved-handle",
    });
    await connection("empty-lc", "empty", "leetcode", {
      username: "another_handle",
    });
    await connection("configured-lc", "configured", "leetcode", {
      username: "do-not-overwrite",
    });
    await connection("invalid-lc", "invalid", "leetcode", {
      username: "../../foreign",
    });
    await connection("long-lc", "long-valid", "leetcode", {
      username: "a".repeat(35),
    });
    await connection("notion", "missing", "notion", {
      workspace: "Imported workspace",
    });
    await connection("github", "missing", "github", {
      username: "owner-login",
    });
    await connection("overleaf", "missing", "overleaf", {
      sourceUrl: "https://www.overleaf.com/project/synthetic",
    });
    await db
      .prepare(
        "INSERT INTO account(id,account_id,provider_id,user_id,access_token,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
      )
      .bind(
        "login-account",
        "missing-github",
        "github",
        "missing",
        "sign-in-token-retained",
        1,
        1,
      )
      .run();
    await db
      .prepare(
        "INSERT INTO connector_oauth_states(state_hash,owner_id,provider,session_hash,expires_at,created_at) VALUES(?,?,?,?,?,?)",
      )
      .bind(
        "oauth-state",
        "missing",
        "notion",
        "session-hash",
        timestamp,
        timestamp,
      )
      .run();
    await db
      .prepare(
        "INSERT INTO connector_webhook_subscriptions(id,owner_id,connection_id,credential,expires_at,created_at) VALUES(?,?,?,?,?,?)",
      )
      .bind(
        "webhook",
        "missing",
        "notion",
        "webhook-secret",
        timestamp,
        timestamp,
      )
      .run();
    await db.exec(sql(migration));
    const preferences = async (id: string) => {
      const row = await db
        .prepare("SELECT data FROM preferences WHERE owner_id=?")
        .bind(id)
        .first<{ data: string }>();
      return row ? JSON.parse(row.data) : null;
    };
    expect(await preferences("missing")).toMatchObject({
      leetcode: "https://leetcode.com/u/saved-handle/",
    });
    expect(await preferences("empty")).toEqual({
      theme: "dark",
      leetcode: "https://leetcode.com/u/another_handle/",
      website: "https://example.invalid/me",
    });
    expect(await preferences("configured")).toEqual({
      leetcode: "https://leetcode.com/u/my-chosen-handle/",
      timezone: "UTC",
      theme: "dark",
    });
    expect(await preferences("invalid")).toBeNull();
    expect(await preferences("long-valid")).toMatchObject({
      leetcode: `https://leetcode.com/u/${"a".repeat(35)}/`,
    });
    const connections = await db
      .prepare(
        "SELECT status,credential,generation,lease_token,lease_until,next_sync_at FROM connector_connections",
      )
      .all();
    expect(connections.results).toHaveLength(8);
    for (const record of connections.results)
      expect(record).toMatchObject({
        status: "disconnected",
        credential: null,
        generation: 5,
        lease_token: null,
        lease_until: null,
        next_sync_at: null,
      });
    expect(
      await db
        .prepare("SELECT access_token FROM account WHERE id='login-account'")
        .first(),
    ).toEqual({ access_token: "sign-in-token-retained" });
    expect(
      await db
        .prepare("SELECT github_id,github_login FROM user WHERE id='missing'")
        .first(),
    ).toEqual({ github_id: "missing-github", github_login: "missing-login" });
    expect(
      (await db.prepare("SELECT * FROM connector_oauth_states").all()).results,
    ).toEqual([]);
    expect(
      await db
        .prepare(
          "SELECT credential FROM connector_webhook_subscriptions WHERE id='webhook'",
        )
        .first(),
    ).toEqual({ credential: null });
  });

  it("detaches imports and snapshots company names without deleting authored content, history or already-set names; rerunning does not change record revisions", async () => {
    await owner("owner");
    await owner("other");
    await connection("notion", "owner", "notion", {
      workspace: "Old workspace",
    });
    const source = {
      provider: "notion",
      sourceId: "saved-page",
      available: false,
      detached: false,
    };
    await savedRecord(
      "imported",
      "owner",
      "note",
      "Imported private note",
      {
        connectorSource: source,
        originalMarkdown: "# Keep original",
        collection: "Unsorted",
      },
      "Keep every authored word",
    );
    await savedRecord("company", "owner", "company", "Known company", {});
    await savedRecord(
      "foreign-company",
      "other",
      "company",
      "Other private company",
      {},
    );
    const history = [{ stage: "Applied", at: timestamp }];
    await savedRecord("application", "owner", "application", "Legacy role", {
      companyId: "company",
      history,
      submittedAssets: [
        { title: "Uploaded résumé snapshot", body: "Preserved evidence" },
      ],
    });
    await savedRecord(
      "named-application",
      "owner",
      "application",
      "Existing display name",
      { companyId: "company", company: "Already chosen company name" },
    );
    await savedRecord(
      "foreign-application",
      "owner",
      "application",
      "Unresolved relation",
      { companyId: "foreign-company" },
    );
    await db
      .prepare(
        "INSERT INTO connector_sources(id,owner_id,connection_id,provider,account_id,source_id,record_id,source_url,snapshot,last_fetched_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        "saved-source",
        "owner",
        "notion",
        "notion",
        "old-account",
        "saved-page",
        "imported",
        "https://example.invalid/source",
        JSON.stringify({ title: "Source snapshot" }),
        timestamp,
      )
      .run();
    await db.exec(sql(migration));
    const imported = await recordData("imported");
    expect(imported).toMatchObject({
      body: "Keep every authored word",
      version: 2,
      data: {
        connectorSource: { ...source, detached: true },
        originalMarkdown: "# Keep original",
        collection: "Unsorted",
      },
    });
    expect((await recordData("application"))?.data).toMatchObject({
      companyId: "company",
      company: "Known company",
      history,
      submittedAssets: [
        { title: "Uploaded résumé snapshot", body: "Preserved evidence" },
      ],
    });
    expect((await recordData("named-application"))?.data.company).toBe(
      "Already chosen company name",
    );
    expect(
      (await recordData("foreign-application"))?.data.company,
    ).toBeUndefined();
    expect(
      await db
        .prepare(
          "SELECT snapshot,record_id FROM connector_sources WHERE id='saved-source'",
        )
        .first(),
    ).toEqual({
      snapshot: JSON.stringify({ title: "Source snapshot" }),
      record_id: "imported",
    });
    const before = await db
      .prepare("SELECT id,data,version,updated_at FROM records ORDER BY id")
      .all();
    const revisions = await db
      .prepare("SELECT count(*) AS count FROM record_revisions")
      .first();
    const generation = await db
      .prepare("SELECT generation FROM connector_connections WHERE id='notion'")
      .first();
    await db.exec(sql(migration));
    expect(
      (
        await db
          .prepare("SELECT id,data,version,updated_at FROM records ORDER BY id")
          .all()
      ).results,
    ).toEqual(before.results);
    expect(
      await db
        .prepare("SELECT count(*) AS count FROM record_revisions")
        .first(),
    ).toEqual(revisions);
    expect(
      await db
        .prepare(
          "SELECT generation FROM connector_connections WHERE id='notion'",
        )
        .first(),
    ).toEqual(generation);
  });
});
