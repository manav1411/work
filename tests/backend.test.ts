import { readFileSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { app } from "../worker";
import { allowedIdentity, createAuth, localAuthAllowed } from "../worker/auth";
import type { Env } from "../worker/env";
import {
  dataReferences,
  fromRow,
  insertLinks,
  insertRecord,
  newRecord,
  type RecordRow,
} from "../worker/db/records";
import {
  DEFAULT_PREFERENCES,
  type Attachment,
  type WorkRecord,
} from "../shared/model";
import type { WorkspaceExport } from "../worker/import-export";

let miniflare: Miniflare;
let env: Env;
const migration = ["0001_workspace.sql", "0002_submitted_files.sql"]
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
  title = "Synthetic note",
  extra: Record<string, unknown> = {},
): Promise<WorkRecord> {
  const response = await request("/api/records", "POST", {
    kind: "note",
    title,
    body: "Private synthetic content",
    ...extra,
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { record: WorkRecord }).record;
}
async function foreignRecord(): Promise<WorkRecord> {
  const timestamp = Date.now();
  await env.DB.prepare(
    "INSERT INTO user(id,name,email,email_verified,created_at,updated_at,github_id,github_login) VALUES(?,?,?,?,?,?,?,?)",
  )
    .bind(
      "other-user",
      "Other",
      "other@example.invalid",
      1,
      timestamp,
      timestamp,
      "other-id",
      "other",
    )
    .run();
  await env.DB.prepare(
    "INSERT INTO records(id,owner_id,kind,title,body,tags,links,data,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
  )
    .bind(
      "other-note",
      "other-user",
      "note",
      "Other private unicorn",
      "other exclusive content",
      "[]",
      "[]",
      "{}",
      1,
      new Date().toISOString(),
      new Date().toISOString(),
    )
    .run();
  return fromRow(
    (await env.DB.prepare("SELECT * FROM records WHERE id=?")
      .bind("other-note")
      .first<RecordRow>())!,
  );
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
    OWNER_GITHUB_LOGIN: "manav1411",
    APP_ORIGIN: "http://localhost",
  };
  // D1 exec accepts a full migration when statements are on a single line.
  await env.DB.exec(migration.replace(/--[^\n]*/g, "").replace(/\n/g, " "));
}, 30_000);
afterAll(async () => {
  await miniflare?.dispose();
}, 30_000);
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM user"),
    env.DB.prepare("DELETE FROM rate_limits"),
    env.DB.prepare("DELETE FROM write_guards"),
  ]);
});

describe("private records and saving", () => {
  it("never seeds records on GET, and retrieves persisted content from another request", async () => {
    expect(await (await request("/api/records")).json()).toEqual({
      records: [],
    });
    const note = await create("An actual next action");
    const records = (await (await request("/api/records")).json()) as {
      records: WorkRecord[];
    };
    expect(records.records[0]).toMatchObject({
      id: note.id,
      title: note.title,
      version: 1,
    });
    expect((await request(`/api/records/${note.id}`)).status).toBe(200);
  });

  it("detects concurrent edits and stores only acknowledged revisions", async () => {
    const note = await create();
    const responses = await Promise.all([
      request(`/api/records/${note.id}`, "PATCH", {
        body: "First draft",
        version: 1,
      }),
      request(`/api/records/${note.id}`, "PATCH", {
        body: "Second draft",
        version: 1,
      }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    const revisions = (await (
      await request(`/api/records/${note.id}/revisions`)
    ).json()) as { revisions: { version: number }[] };
    expect(revisions.revisions.map((revision) => revision.version)).toEqual([
      2, 1,
    ]);
    const guards = await env.DB.prepare(
      "SELECT count(*) AS count FROM write_guards",
    ).first<{ count: number }>();
    expect(guards?.count).toBe(0);
  });

  it("records stage history atomically with the application revision", async () => {
    const note = await create("Role", {
      kind: "application",
      data: { stage: "Saved" },
    });
    const response = await request(`/api/records/${note.id}`, "PATCH", {
      data: { stage: "Applied" },
      version: 1,
    });
    const result = (await response.json()) as { record: WorkRecord };
    expect(result.record.data.history).toEqual([
      expect.objectContaining({ previous: "Saved", stage: "Applied" }),
    ]);
    const revisions = (await (
      await request(`/api/records/${note.id}/revisions`)
    ).json()) as { revisions: WorkRecord[] };
    expect(revisions.revisions[0].data.history).toEqual(
      result.record.data.history,
    );
  });

  it("makes offline retries idempotent and rejects reused keys with new content", async () => {
    const payload = { kind: "action", title: "One small thing" };
    const headers = { "Idempotency-Key": "synthetic-retry-001" };
    const one = await (
      await request("/api/records", "POST", payload, headers)
    ).json();
    const two = await (
      await request("/api/records", "POST", payload, headers)
    ).json();
    expect(two).toEqual(one);
    expect(
      (
        await request(
          "/api/records",
          "POST",
          { ...payload, title: "Different thing" },
          headers,
        )
      ).status,
    ).toBe(409);
    const records = (await (await request("/api/records")).json()) as {
      records: WorkRecord[];
    };
    expect(records.records).toHaveLength(1);
  });

  it("acknowledges retried offline updates without duplicate revisions or losing links", async () => {
    const parent = await create("Parent");
    const note = await create("Child", {
      links: [parent.id],
      tags: ["keep-me"],
    });
    const patch = { body: "Recovered offline draft", version: note.version };
    const headers = { "Idempotency-Key": "synthetic-update-001" };
    const first = (await (
      await request(`/api/records/${note.id}`, "PATCH", patch, headers)
    ).json()) as { record: WorkRecord };
    const retry = await request(
      `/api/records/${note.id}`,
      "PATCH",
      patch,
      headers,
    );
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual(first);
    expect(first.record.links).toEqual([parent.id]);
    expect(first.record.tags).toEqual(["keep-me"]);
    const revisions = (await (
      await request(`/api/records/${note.id}/revisions`)
    ).json()) as { revisions: unknown[] };
    expect(revisions.revisions).toHaveLength(2);
  });

  it("creates a comprehensive starter batch atomically under D1 parameter limits", async () => {
    const response = await request("/api/records/batch", "POST", {
      records: Array.from({ length: 400 }, (_, index) => ({
        kind: "resource",
        title: `Synthetic resource ${index}`,
        data: { url: "https://example.invalid/resource" },
      })),
      idempotencyKey: "synthetic-batch-001",
    });
    expect(response.status).toBe(201);
    const results = (await response.json()) as { records: WorkRecord[] };
    expect(results.records).toHaveLength(400);
    const existing = (await (await request("/api/records")).json()) as {
      records: WorkRecord[];
    };
    expect(existing.records).toHaveLength(400);
  });

  it("provides searchable recoverable trash and retains links through trash", async () => {
    const note = await create("Unicorn learn");
    const linked = await create("Linked action", {
      kind: "action",
      links: [note.id],
    });
    await request(`/api/records/${note.id}`, "DELETE");
    const search = (await (await request("/api/search?q=unicorn")).json()) as {
      records: WorkRecord[];
    };
    expect(search.records).toHaveLength(0);
    expect((await request(`/api/records/${linked.id}`, "DELETE")).status).toBe(
      200,
    );
    expect(
      (await request(`/api/records/${linked.id}/restore`, "POST")).status,
    ).toBe(200);
    await request(`/api/records/${note.id}/restore`, "POST");
    const restored = (await (await request("/api/search?q=uni")).json()) as {
      records: WorkRecord[];
    };
    expect(restored.records.map((record) => record.id)).toContain(note.id);
  });

  it("rejects another owner across records, search, links, revisions, related data and export", async () => {
    const other = await foreignRecord();
    for (const suffix of ["", "/revisions", "/attachments", "/related"])
      expect((await request(`/api/records/${other.id}${suffix}`)).status).toBe(
        404,
      );
    expect(
      (
        await request(`/api/records/${other.id}`, "PATCH", {
          title: "intrusion",
          version: 1,
        })
      ).status,
    ).toBe(404);
    expect((await request(`/api/records/${other.id}`, "DELETE")).status).toBe(
      404,
    );
    expect(
      (await request(`/api/records/${other.id}/restore`, "POST")).status,
    ).toBe(404);
    expect(
      (
        await request("/api/records", "POST", {
          kind: "note",
          title: "Bad link",
          links: [other.id],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/api/records", "POST", {
          kind: "application",
          title: "Bad relation",
          data: { companyId: other.id },
        })
      ).status,
    ).toBe(400);
    const search = (await (await request("/api/search?q=unicorn")).json()) as {
      records: WorkRecord[];
    };
    expect(search.records).toEqual([]);
    const exported = (await (
      await request("/api/export")
    ).json()) as WorkspaceExport;
    expect(exported.records).toEqual([]);
  });

  it("validates URLs, content size and malformed FTS expressions", async () => {
    expect(
      (
        await request("/api/records", "POST", {
          kind: "resource",
          title: "Bad URL",
          data: { url: "javascript:alert(1)" },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/api/records", "POST", {
          kind: "note",
          title: "Too big",
          body: "x".repeat(500_001),
        })
      ).status,
    ).toBe(400);
    expect(
      (await request("/api/search?q=%22%20OR%20*%20NOT%20%3A")).status,
    ).toBe(200);
    expect(
      (
        await request("/api/preferences", "PUT", {
          ...DEFAULT_PREFERENCES,
          timezone: "Invalid/Zone",
        })
      ).status,
    ).toBe(400);
  });
});

describe("authentication boundaries", () => {
  it("fails closed for production, staging, or a public hostname even when fixture flags are present", async () => {
    for (const environment of ["production", "staging"] as const) {
      const production = { ...env, ENVIRONMENT: environment };
      expect(
        localAuthAllowed(
          production,
          new Request("http://localhost/api/session"),
        ),
      ).toBe(false);
      expect(
        await (
          await request("/api/session", "GET", undefined, {}, production)
        ).json(),
      ).toMatchObject({ user: null, local: false, configured: false });
      expect(
        (
          await request(
            "/api/records",
            "POST",
            { kind: "note", title: "Blocked" },
            {},
            production,
          )
        ).status,
      ).toBe(401);
    }
    expect(
      localAuthAllowed(
        env,
        new Request("https://work.manavdodia.com/api/session"),
      ),
    ).toBe(false);
    expect(
      allowedIdentity(
        { ...env, OWNER_GITHUB_ID: "98765" },
        "67890",
        "manav1411",
      ),
    ).toBe(false);
    expect(
      allowedIdentity({ ...env, OWNER_GITHUB_ID: "98765" }, "98765", "renamed"),
    ).toBe(true);
    expect(allowedIdentity(env, "local", "manav1411")).toBe(false);
  });

  it("rejects cross-origin changes and returns structured API errors rather than the SPA", async () => {
    expect(
      (
        await request(
          "/api/records",
          "POST",
          { kind: "note", title: "Blocked" },
          { Origin: "https://attacker.invalid" },
        )
      ).status,
    ).toBe(403);
    const response = await request(
      "/api/unknown",
      "GET",
      undefined,
      {},
      { ...env, ENVIRONMENT: "production" },
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(await response.json()).toMatchObject({
      error: { code: "NOT_FOUND" },
    });
  });

  it("uses real signed Better Auth sessions and the Drizzle D1 schema", async () => {
    const production: Env = {
      ...env,
      ENVIRONMENT: "production",
      APP_ORIGIN: "https://work.example.invalid",
      BETTER_AUTH_SECRET: "synthetic-test-secret-with-at-least-32-characters",
      GITHUB_CLIENT_ID: "synthetic-client",
      GITHUB_CLIENT_SECRET: "synthetic-client-secret",
      OWNER_GITHUB_ID: "12345",
    };
    const timestamp = Date.now();
    const token = "synthetic-secret-session-token";
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO user(id,name,email,email_verified,created_at,updated_at,github_id,github_login) VALUES(?,?,?,?,?,?,?,?)",
      ).bind(
        "verified-owner",
        "Owner",
        "owner@example.invalid",
        1,
        timestamp,
        timestamp,
        "12345",
        "manav1411",
      ),
      env.DB.prepare(
        "INSERT INTO session(id,expires_at,token,created_at,updated_at,user_id) VALUES(?,?,?,?,?,?)",
      ).bind(
        "verified-session",
        timestamp + 86_400_000,
        token,
        timestamp,
        timestamp,
        "verified-owner",
      ),
    ]);
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(production.BETTER_AUTH_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = btoa(
      String.fromCharCode(
        ...new Uint8Array(
          await crypto.subtle.sign(
            "HMAC",
            cryptoKey,
            new TextEncoder().encode(token),
          ),
        ),
      ),
    );
    const headers = {
      Cookie: `__Secure-better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`,
    };
    const session = await (
      await request("/api/session", "GET", undefined, headers, production)
    ).json();
    expect(session).toMatchObject({
      user: { id: "verified-owner" },
      local: false,
      configured: true,
    });
    const invalid = await (
      await request(
        "/api/session",
        "GET",
        undefined,
        { Cookie: "__Secure-better-auth.session_token=forged" },
        production,
      )
    ).json();
    expect(invalid).toMatchObject({ user: null });
    const auth = createAuth(production);
    const context = await auth.$context;
    expect(context.authCookies.sessionToken.attributes).toMatchObject({
      secure: true,
      httpOnly: true,
      sameSite: "lax",
    });
    expect(context.authCookies.sessionToken.attributes.domain).toBeUndefined();
  });

  it("starts protected GitHub OAuth with persisted state and blocks open callback URLs", async () => {
    const production: Env = {
      ...env,
      ENVIRONMENT: "production",
      APP_ORIGIN: "https://work.example.invalid",
      BETTER_AUTH_SECRET: "synthetic-test-secret-with-at-least-32-characters",
      GITHUB_CLIENT_ID: "synthetic-client",
      GITHUB_CLIENT_SECRET: "synthetic-client-secret",
      OWNER_GITHUB_ID: "12345",
    };
    const response = await request(
      "/api/auth/sign-in/social",
      "POST",
      { provider: "github", callbackURL: "https://work.example.invalid/today" },
      { Origin: production.APP_ORIGIN },
      production,
    );
    expect(response.status).toBe(200);
    const result = (await response.json()) as { url: string };
    const url = new URL(result.url);
    expect(url.hostname).toBe("github.com");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://work.example.invalid/api/auth/callback/github",
    );
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(response.headers.get("Set-Cookie")).toContain("Secure");
    const states = await env.DB.prepare(
      "SELECT count(*) AS count FROM verification",
    ).first<{ count: number }>();
    expect(states?.count).toBeGreaterThan(0);
    const invalid = await request(
      "/api/auth/sign-in/social",
      "POST",
      { provider: "github", callbackURL: "https://attacker.invalid" },
      { Origin: production.APP_ORIGIN },
      production,
    );
    expect(invalid.status).toBe(403);
    const auth = createAuth(production);
    const mapper = auth.options.socialProviders.github.mapProfileToUser;
    type Profile = Parameters<NonNullable<typeof mapper>>[0];
    await expect(
      mapper?.({ id: "67890", login: "manav1411" } as Profile),
    ).rejects.toMatchObject({ status: "FORBIDDEN" });
    await expect(
      mapper?.({ id: "12345", login: "renamed-owner" } as Profile),
    ).resolves.toMatchObject({
      githubId: "12345",
      githubLogin: "renamed-owner",
    });
  });
});

describe("private files, migration and backups", () => {
  it("validates uploads and prevents access to another user’s private R2 files", async () => {
    const note = await create();
    const form = new FormData();
    form.set(
      "file",
      new File(["%PDF-1.7\nsynthetic"], "../../resume.pdf", {
        type: "application/pdf",
      }),
    );
    const result = await request(
      `/api/records/${note.id}/attachments`,
      "POST",
      form,
    );
    expect(result.status).toBe(201);
    const attachment = ((await result.json()) as { attachment: Attachment })
      .attachment;
    expect(attachment.filename).toBe("resume.pdf");
    const downloaded = await request(`/api/attachments/${attachment.id}`);
    expect(downloaded.status).toBe(200);
    expect(await downloaded.text()).toBe("%PDF-1.7\nsynthetic");
    expect(downloaded.headers.get("Cache-Control")).toContain("no-store");
    const invalid = new FormData();
    invalid.set(
      "file",
      new File(["<script>alert(1)</script>"], "bad.pdf", {
        type: "application/pdf",
      }),
    );
    expect(
      (await request(`/api/records/${note.id}/attachments`, "POST", invalid))
        .status,
    ).toBe(415);
    const other = await foreignRecord();
    await env.FILES.put("other-user/private", "private");
    await env.DB.prepare(
      "INSERT INTO attachments(id,owner_id,record_id,object_key,filename,content_type,size,created_at) VALUES(?,?,?,?,?,?,?,?)",
    )
      .bind(
        "other-attachment",
        "other-user",
        other.id,
        "other-user/private",
        "private.txt",
        "text/plain",
        7,
        new Date().toISOString(),
      )
      .run();
    expect((await request("/api/attachments/other-attachment")).status).toBe(
      404,
    );
    expect(
      (await request("/api/attachments/other-attachment", "DELETE")).status,
    ).toBe(404);
    await request(`/api/records/${note.id}`, "DELETE");
    expect((await request(`/api/attachments/${attachment.id}`)).status).toBe(
      404,
    );
    await request(`/api/records/${note.id}/restore`, "POST");
    expect((await request(`/api/attachments/${attachment.id}`)).status).toBe(
      200,
    );
  });

  it("protects captured application PDFs at both API and database boundaries", async () => {
    const asset = await create("Submitted résumé", { kind: "asset" });
    const form = new FormData();
    form.set(
      "file",
      new File(["%PDF-1.7\nsubmitted synthetic"], "resume.pdf", {
        type: "application/pdf",
      }),
    );
    const file = (
      (await (
        await request(`/api/records/${asset.id}/attachments`, "POST", form)
      ).json()) as { attachment: Attachment }
    ).attachment;
    const application = await create("Applied role", {
      kind: "application",
      links: [asset.id],
      data: {
        stage: "Applied",
        assetVersions: [
          {
            assetId: asset.id,
            attachmentId: file.id,
            version: 1,
            body: "Submitted content",
          },
        ],
      },
    });
    expect(
      (await request(`/api/attachments/${file.id}`, "DELETE")).status,
    ).toBe(409);
    expect((await request(`/api/records/${asset.id}`, "DELETE")).status).toBe(
      409,
    );
    await expect(
      env.DB.prepare("DELETE FROM attachments WHERE id=?").bind(file.id).run(),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);
    expect((await request(`/api/attachments/${file.id}`)).status).toBe(200);
    expect(
      (
        await request(`/api/records/${application.id}`, "PATCH", {
          data: { ...application.data, assetVersions: [] },
          version: 1,
        })
      ).status,
    ).toBe(200);
    expect(
      (await request(`/api/attachments/${file.id}`, "DELETE")).status,
    ).toBe(200);
  });

  it("round-trips backups after permanently deleting referenced records and their files", async () => {
    const company = await create("Permanently deleted company", {
      kind: "company",
    });
    const retained = await create("Retained company", { kind: "company" });
    const form = new FormData();
    form.set(
      "file",
      new File(["%PDF-1.7\nsynthetic research"], "research.pdf", {
        type: "application/pdf",
      }),
    );
    const attachment = (
      (await (
        await request(`/api/records/${company.id}/attachments`, "POST", form)
      ).json()) as { attachment: Attachment }
    ).attachment;
    const snapshotText = `Original research for ${company.id}; file ${attachment.id}`;
    const asset = await create("Keep this evidence", {
      kind: "asset",
      links: [company.id, retained.id],
      data: {
        companyId: company.id,
        primaryAttachmentId: attachment.id,
        retainedCompanyId: retained.id,
        snapshotText,
        nested: {
          companyId: company.id,
          recordIds: [company.id, retained.id],
          companyIds: [company.id, retained.id],
          assetIds: [company.id, retained.id],
          snapshots: [
            {
              recordId: company.id,
              attachmentId: attachment.id,
              body: snapshotText,
            },
          ],
        },
      },
    });
    const other = await foreignRecord();
    const otherData = {
      companyId: company.id,
      primaryAttachmentId: attachment.id,
      snapshotText,
    };
    await env.DB.prepare(
      "UPDATE records SET data=?,version=version+1 WHERE id=? AND owner_id=?",
    )
      .bind(JSON.stringify(otherData), other.id, "other-user")
      .run();

    expect((await request(`/api/records/${company.id}`, "DELETE")).status).toBe(
      200,
    );
    expect(
      (await request(`/api/records/${company.id}/permanent`, "DELETE")).status,
    ).toBe(200);
    const current = (await (
      await request(`/api/records/${asset.id}`)
    ).json()) as { record: WorkRecord };
    const references = dataReferences(current.record.data);
    expect(references.records).not.toContain(company.id);
    expect(references.files).not.toContain(attachment.id);
    expect(references.records).toContain(retained.id);
    expect(current.record.links).toEqual([retained.id]);
    expect(current.record.data.snapshotText).toBe(snapshotText);
    expect(
      (current.record.data.nested as { snapshots: { body: string }[] })
        .snapshots[0].body,
    ).toBe(snapshotText);
    expect(current.record.version).toBeGreaterThan(asset.version);
    const otherRow = await env.DB.prepare(
      "SELECT data FROM records WHERE id=? AND owner_id=?",
    )
      .bind(other.id, "other-user")
      .first<{ data: string }>();
    expect(JSON.parse(otherRow!.data)).toEqual(otherData);
    expect((await request(`/api/attachments/${attachment.id}`)).status).toBe(
      404,
    );

    const backup = (await (
      await request("/api/export")
    ).json()) as WorkspaceExport;
    expect(backup.records).toHaveLength(2);
    expect(backup.attachments).toHaveLength(0);
    const restoredResponse = await request("/api/restore", "POST", backup);
    expect(restoredResponse.status).toBe(201);
    const restored = (await restoredResponse.json()) as {
      records: WorkRecord[];
    };
    const copiedAsset = restored.records.find(
      (record) => record.title === asset.title,
    )!;
    const copiedCompany = restored.records.find(
      (record) => record.title === retained.title,
    )!;
    expect(copiedAsset.links).toEqual([copiedCompany.id]);
    expect(dataReferences(copiedAsset.data).records).toContain(
      copiedCompany.id,
    );
    expect(copiedAsset.data.snapshotText).toBe(snapshotText);
  });

  it("round-trips backups after deleting a non-submitted primary file without changing unrelated data", async () => {
    const asset = await create("Editable résumé", { kind: "asset" });
    const upload = async (filename: string) => {
      const form = new FormData();
      form.set(
        "file",
        new File([`%PDF-1.7\n${filename}`], filename, {
          type: "application/pdf",
        }),
      );
      return (
        (await (
          await request(`/api/records/${asset.id}/attachments`, "POST", form)
        ).json()) as { attachment: Attachment }
      ).attachment;
    };
    const primary = await upload("old.pdf");
    const retained = await upload("keep.pdf");
    const snapshotText = `Original primary document ${primary.id}`;
    expect(
      (
        await request(`/api/records/${asset.id}`, "PATCH", {
          version: asset.version,
          data: {
            primaryAttachmentId: primary.id,
            snapshotText,
            nested: [
              { attachmentId: primary.id, body: snapshotText },
              { attachmentId: retained.id },
            ],
          },
        })
      ).status,
    ).toBe(200);
    const other = await foreignRecord();
    const otherData = { primaryAttachmentId: primary.id, snapshotText };
    await env.DB.prepare(
      "UPDATE records SET data=?,version=version+1 WHERE id=? AND owner_id=?",
    )
      .bind(JSON.stringify(otherData), other.id, "other-user")
      .run();

    expect(
      (await request(`/api/attachments/${primary.id}`, "DELETE")).status,
    ).toBe(200);
    const current = (await (
      await request(`/api/records/${asset.id}`)
    ).json()) as { record: WorkRecord };
    expect(dataReferences(current.record.data).files).not.toContain(primary.id);
    expect(dataReferences(current.record.data).files).toContain(retained.id);
    expect(current.record.data.snapshotText).toBe(snapshotText);
    expect((current.record.data.nested as { body?: string }[])[0].body).toBe(
      snapshotText,
    );
    expect((await request(`/api/attachments/${retained.id}`)).status).toBe(200);
    const otherRow = await env.DB.prepare(
      "SELECT data FROM records WHERE id=? AND owner_id=?",
    )
      .bind(other.id, "other-user")
      .first<{ data: string }>();
    expect(JSON.parse(otherRow!.data)).toEqual(otherData);

    const backup = (await (
      await request("/api/export")
    ).json()) as WorkspaceExport;
    expect(backup.attachments.map((attachment) => attachment.id)).toEqual([
      retained.id,
    ]);
    const restoredResponse = await request("/api/restore", "POST", backup);
    expect(restoredResponse.status).toBe(201);
    const restored = (await restoredResponse.json()) as {
      records: WorkRecord[];
      attachments: number;
    };
    expect(restored.attachments).toBe(1);
    expect(dataReferences(restored.records[0].data).files).toHaveLength(1);
    expect(restored.records[0].data.snapshotText).toBe(snapshotText);
  });

  it("rolls back permanent deletion when a related record changes after the detach scan", async () => {
    const target = await create("Trash parent");
    const form = new FormData();
    const fileText = "Synthetic file that must survive the conflict";
    form.set(
      "file",
      new File([fileText], "conflict.txt", { type: "text/plain" }),
    );
    const attachment = (
      (await (
        await request(`/api/records/${target.id}/attachments`, "POST", form)
      ).json()) as { attachment: Attachment }
    ).attachment;
    const related = await create("Original related title", {
      links: [target.id],
      data: { recordId: target.id, primaryAttachmentId: attachment.id },
    });
    expect((await request(`/api/records/${target.id}`, "DELETE")).status).toBe(
      200,
    );
    let injected = false;
    const guardedDatabase = new Proxy(env.DB, {
      get(database, property) {
        if (property === "batch")
          return async (statements: D1PreparedStatement[]) => {
            if (!injected) {
              injected = true;
              const edit = await request(
                `/api/records/${related.id}`,
                "PATCH",
                {
                  version: related.version,
                  title: "Concurrent title must survive",
                  body: "Concurrent body must survive",
                },
              );
              expect(edit.status).toBe(200);
            }
            return database.batch(statements);
          };
        const value = Reflect.get(database, property);
        return typeof value === "function" ? value.bind(database) : value;
      },
    });
    const response = await request(
      `/api/records/${target.id}/permanent`,
      "DELETE",
      undefined,
      {},
      { ...env, DB: guardedDatabase },
    );
    expect(injected).toBe(true);
    expect(response.status).toBe(409);
    const retainedTarget = (await (
      await request(`/api/records/${target.id}?includeDeleted=true`)
    ).json()) as { record: WorkRecord };
    expect(retainedTarget.record.deletedAt).not.toBeNull();
    const current = (await (
      await request(`/api/records/${related.id}`)
    ).json()) as { record: WorkRecord };
    expect(current.record).toMatchObject({
      title: "Concurrent title must survive",
      body: "Concurrent body must survive",
      version: related.version + 1,
    });
    expect(current.record.links).toEqual([target.id]);
    expect(current.record.data).toEqual(related.data);
    const retainedFile = await env.DB.prepare(
      "SELECT object_key FROM attachments WHERE id=? AND owner_id=?",
    )
      .bind(attachment.id, "local-manav")
      .first<{ object_key: string }>();
    expect(retainedFile).not.toBeNull();
    expect(await (await env.FILES.get(retainedFile!.object_key))?.text()).toBe(
      fileText,
    );
    expect(
      await env.DB.prepare("SELECT count(*) AS count FROM write_guards").first<{
        count: number;
      }>(),
    ).toEqual({ count: 0 });
  });

  it("preserves a submitted file captured after the initial deletion precheck", async () => {
    const asset = await create("Résumé being submitted", { kind: "asset" });
    const form = new FormData();
    const fileText = "%PDF-1.7\nSynthetic concurrent submission";
    form.set(
      "file",
      new File([fileText], "submitted.pdf", { type: "application/pdf" }),
    );
    const attachment = (
      (await (
        await request(`/api/records/${asset.id}/attachments`, "POST", form)
      ).json()) as { attachment: Attachment }
    ).attachment;
    expect(
      (
        await request(`/api/records/${asset.id}`, "PATCH", {
          version: asset.version,
          data: { primaryAttachmentId: attachment.id },
        })
      ).status,
    ).toBe(200);
    let captured: WorkRecord | null = null;
    const wrapStatement = (
      statement: D1PreparedStatement,
    ): D1PreparedStatement =>
      new Proxy(statement, {
        get(current, property) {
          if (property === "bind")
            return (...values: unknown[]) =>
              wrapStatement(current.bind(...values));
          if (property === "all")
            return async () => {
              if (!captured) {
                captured = await create("Concurrent submitted application", {
                  kind: "application",
                  links: [asset.id],
                  data: {
                    stage: "Applied",
                    assetVersions: [
                      {
                        assetId: asset.id,
                        attachmentId: attachment.id,
                        body: "Immutable submitted content",
                      },
                    ],
                  },
                });
              }
              return current.all();
            };
          const value = Reflect.get(current, property);
          return typeof value === "function" ? value.bind(current) : value;
        },
      });
    const guardedDatabase = new Proxy(env.DB, {
      get(database, property) {
        if (property === "prepare")
          return (sql: string) => {
            const statement = database.prepare(sql);
            return sql.includes("json_tree(records.data)") &&
              sql.includes("id!=?")
              ? wrapStatement(statement)
              : statement;
          };
        const value = Reflect.get(database, property);
        return typeof value === "function" ? value.bind(database) : value;
      },
    });
    const response = await request(
      `/api/attachments/${attachment.id}`,
      "DELETE",
      undefined,
      {},
      { ...env, DB: guardedDatabase },
    );
    expect(captured).not.toBeNull();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "FILE_IN_USE" },
    });
    const application = (await (
      await request(`/api/records/${(captured as unknown as WorkRecord).id}`)
    ).json()) as { record: WorkRecord };
    expect(application.record.data.assetVersions).toEqual([
      {
        assetId: asset.id,
        attachmentId: attachment.id,
        body: "Immutable submitted content",
      },
    ]);
    const currentAsset = (await (
      await request(`/api/records/${asset.id}`)
    ).json()) as { record: WorkRecord };
    expect(currentAsset.record.data.primaryAttachmentId).toBe(attachment.id);
    const download = await request(`/api/attachments/${attachment.id}`);
    expect(download.status).toBe(200);
    expect(await download.text()).toBe(fileText);
  });

  it("refuses permanent deletion when a new referencing record commits after the detach scan", async () => {
    const target = await create("Target of delayed creation");
    const lateRecord = newRecord({
      kind: "note",
      title: "Previously validated creation",
      body: "Preserve this concurrent capture",
      links: [target.id],
      data: { recordId: target.id, nested: { recordIds: [target.id] } },
    });
    expect((await request(`/api/records/${target.id}`, "DELETE")).status).toBe(
      200,
    );
    let injected = false;
    const guardedDatabase = new Proxy(env.DB, {
      get(database, property) {
        if (property === "batch")
          return async (statements: D1PreparedStatement[]) => {
            if (!injected) {
              injected = true;
              // Model a request validated while the target was live whose write
              // commits only after this deletion's candidate scan has completed.
              await database.batch([
                insertRecord(database, "local-manav", lateRecord),
                ...insertLinks(database, "local-manav", lateRecord),
              ]);
            }
            return database.batch(statements);
          };
        const value = Reflect.get(database, property);
        return typeof value === "function" ? value.bind(database) : value;
      },
    });
    const response = await request(
      `/api/records/${target.id}/permanent`,
      "DELETE",
      undefined,
      {},
      { ...env, DB: guardedDatabase },
    );
    expect(injected).toBe(true);
    expect(response.status).toBe(409);
    const retainedTarget = (await (
      await request(`/api/records/${target.id}?includeDeleted=true`)
    ).json()) as { record: WorkRecord };
    expect(retainedTarget.record.deletedAt).not.toBeNull();
    const preservedCapture = (await (
      await request(`/api/records/${lateRecord.id}`)
    ).json()) as { record: WorkRecord };
    expect(preservedCapture.record).toMatchObject({
      title: lateRecord.title,
      body: lateRecord.body,
      version: 1,
      links: [target.id],
      data: lateRecord.data,
    });
    const normalizedLink = await env.DB.prepare(
      "SELECT target_id FROM record_links WHERE owner_id=? AND source_id=?",
    )
      .bind("local-manav", lateRecord.id)
      .first<{ target_id: string }>();
    expect(normalizedLink?.target_id).toBe(target.id);
    const backup = (await (
      await request("/api/export")
    ).json()) as WorkspaceExport;
    expect((await request("/api/restore", "POST", backup)).status).toBe(201);
  });

  it("rejects single and batch creates when structured-reference targets disappear after preflight", async () => {
    for (const endpoint of ["/api/records", "/api/records/batch"]) {
      for (const deletedTarget of ["record", "file"]) {
        const target = await create(
          `Reference race ${endpoint} ${deletedTarget}`,
          { kind: "asset" },
        );
        const form = new FormData();
        form.set(
          "file",
          new File(["%PDF-1.7\nSynthetic reference target"], "reference.pdf", {
            type: "application/pdf",
          }),
        );
        const attachment = (
          (await (
            await request(`/api/records/${target.id}/attachments`, "POST", form)
          ).json()) as { attachment: Attachment }
        ).attachment;
        const title = `Must not commit ${endpoint} ${deletedTarget}`;
        const input = {
          kind: "note",
          title,
          data:
            deletedTarget === "record"
              ? { recordId: target.id }
              : { recordId: target.id, primaryAttachmentId: attachment.id },
        };
        let injected = false;
        const guardedDatabase = new Proxy(env.DB, {
          get(database, property) {
            if (property === "batch")
              return async (statements: D1PreparedStatement[]) => {
                if (!injected) {
                  injected = true;
                  if (deletedTarget === "record") {
                    expect(
                      (await request(`/api/records/${target.id}`, "DELETE"))
                        .status,
                    ).toBe(200);
                    expect(
                      (
                        await request(
                          `/api/records/${target.id}/permanent`,
                          "DELETE",
                        )
                      ).status,
                    ).toBe(200);
                  } else {
                    expect(
                      (
                        await request(
                          `/api/attachments/${attachment.id}`,
                          "DELETE",
                        )
                      ).status,
                    ).toBe(200);
                  }
                }
                return database.batch(statements);
              };
            const value = Reflect.get(database, property);
            return typeof value === "function" ? value.bind(database) : value;
          },
        });
        const response = await request(
          endpoint,
          "POST",
          endpoint.endsWith("/batch") ? { records: [input] } : input,
          {},
          { ...env, DB: guardedDatabase },
        );
        expect(injected).toBe(true);
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({
          error: { code: "REFERENCE_CONFLICT" },
        });
        expect(
          await env.DB.prepare(
            "SELECT count(*) AS count FROM records WHERE owner_id=? AND title=?",
          )
            .bind("local-manav", title)
            .first<{ count: number }>(),
        ).toEqual({ count: 0 });
        expect(
          await env.DB.prepare(
            "SELECT count(*) AS count FROM write_guards",
          ).first<{ count: number }>(),
        ).toEqual({ count: 0 });
      }
    }
  });

  it("imports encoded note links, circular relations and private attachments idempotently", async () => {
    const payload = {
      source: "synthetic-notion",
      mode: "keep",
      records: [
        {
          sourceId: "Folder/Note a 123.md",
          hash: "original-a",
          record: {
            kind: "note",
            title: "A",
            body: "[B](work-source://B%20b.md)\n![image](work-attachment://image.png)",
            links: ["B b.md"],
          },
          attachments: [
            {
              filename: "image.png",
              contentType: "image/png",
              base64: btoa(
                String.fromCharCode(
                  0x89,
                  0x50,
                  0x4e,
                  0x47,
                  0x0d,
                  0x0a,
                  0x1a,
                  0x0a,
                  0,
                ),
              ),
            },
          ],
        },
        {
          sourceId: "B b.md",
          hash: "original-b",
          record: {
            kind: "note",
            title: "B",
            body: '```python\nprint("Hello")\n```',
            links: ["Folder/Note a 123.md"],
          },
        },
      ],
    };
    const response = await request("/api/import", "POST", payload);
    expect(response.status).toBe(201);
    const imported = (await response.json()) as {
      batchId: string;
      created: number;
      records: WorkRecord[];
    };
    expect(imported.created).toBe(2);
    expect(imported.records[0].links).toEqual([imported.records[1].id]);
    expect(imported.records[0].body).toContain(
      `/notes?record=${imported.records[1].id}`,
    );
    expect(imported.records[0].body).toMatch(
      /!\[image\]\(\/api\/attachments\//,
    );
    expect(imported.records[1].body).toContain("```python");
    const repeated = (await (
      await request("/api/import", "POST", payload)
    ).json()) as { skipped: number };
    expect(repeated.skipped).toBe(2);
    expect(
      (await request(`/api/import/${imported.batchId}/undo`, "POST")).status,
    ).toBe(200);
    const records = (await (await request("/api/records")).json()) as {
      records: WorkRecord[];
    };
    expect(records.records).toEqual([]);
    expect(
      (await request(`/api/records/${imported.records[0].id}/restore`, "POST"))
        .status,
    ).toBe(200);
    const files = (await (
      await request(`/api/records/${imported.records[0].id}/attachments`)
    ).json()) as { attachments: Attachment[] };
    expect(files.attachments).toHaveLength(1);
    expect(
      (await request(`/api/attachments/${files.attachments[0].id}`)).status,
    ).toBe(200);
  });

  it("keeps, merges, replaces and safely undoes changed imports without losing later edits", async () => {
    const payload = {
      source: "synthetic-source",
      records: [
        {
          sourceId: "one",
          hash: "old",
          record: { kind: "note", title: "Old", body: "Old content" },
        },
      ],
    };
    const original = (await (
      await request("/api/import", "POST", payload)
    ).json()) as { records: WorkRecord[] };
    const changed = {
      ...payload,
      records: [
        {
          ...payload.records[0],
          hash: "new",
          record: { ...payload.records[0].record, body: "New content" },
        },
      ],
    };
    expect(
      await (await request("/api/import", "POST", changed)).json(),
    ).toMatchObject({ created: 0, updated: 0, skipped: 1 });
    const updated = (await (
      await request("/api/import", "POST", { ...changed, mode: "merge" })
    ).json()) as { batchId: string; records: WorkRecord[] };
    expect(updated.records[0].body).toContain(
      "Old content\n\n---\n\nNew content",
    );
    expect(
      (await request(`/api/import/${updated.batchId}/undo`, "POST")).status,
    ).toBe(200);
    const restored = (await (
      await request(`/api/records/${original.records[0].id}`)
    ).json()) as { record: WorkRecord };
    expect(restored.record.body).toBe("Old content");
    const replacement = (await (
      await request("/api/import", "POST", { ...changed, mode: "replace" })
    ).json()) as { batchId: string; records: WorkRecord[] };
    await request(`/api/records/${replacement.records[0].id}`, "PATCH", {
      body: "Later personal edit",
      version: replacement.records[0].version,
    });
    expect(
      (await request(`/api/import/${replacement.batchId}/undo`, "POST")).status,
    ).toBe(409);
    expect(
      (
        (await (
          await request(`/api/records/${original.records[0].id}`)
        ).json()) as { record: WorkRecord }
      ).record.body,
    ).toBe("Later personal edit");
  });

  it("refuses replacement-import undo when another record uses its replacement file", async () => {
    const originalPdf = "%PDF-1.7\nOriginal resume";
    const replacementPdf = "%PDF-1.7\nReplacement resume";
    const payload = {
      source: "synthetic-resume-undo",
      records: [
        {
          sourceId: "resume",
          hash: "original",
          record: {
            kind: "asset",
            title: "Imported résumé",
            body: "Original résumé content",
          },
          attachments: [
            {
              filename: "original.pdf",
              contentType: "application/pdf",
              base64: btoa(originalPdf),
            },
          ],
        },
      ],
    };
    expect((await request("/api/import", "POST", payload)).status).toBe(201);
    const replacementResponse = await request("/api/import", "POST", {
      ...payload,
      mode: "replace",
      records: [
        {
          ...payload.records[0],
          hash: "replacement",
          record: {
            ...payload.records[0].record,
            body: "Replacement résumé content",
          },
          attachments: [
            {
              filename: "replacement.pdf",
              contentType: "application/pdf",
              base64: btoa(replacementPdf),
            },
          ],
        },
      ],
    });
    expect(replacementResponse.status).toBe(201);
    const replacement = (await replacementResponse.json()) as {
      batchId: string;
      records: WorkRecord[];
    };
    const imported = replacement.records[0];
    const replacementFileId = imported.data.primaryAttachmentId as string;
    expect(replacementFileId).toBeTruthy();
    const separate = await create("Separate non-application evidence", {
      kind: "asset",
      body: "Keep this independent content unchanged",
      data: {
        attachmentId: replacementFileId,
        primaryAttachmentId: replacementFileId,
      },
    });
    const response = await request(
      `/api/import/${replacement.batchId}/undo`,
      "POST",
    );
    expect(response.status).toBe(409);
    const currentImported = (await (
      await request(`/api/records/${imported.id}`)
    ).json()) as { record: WorkRecord };
    expect(currentImported.record).toEqual(imported);
    const currentSeparate = (await (
      await request(`/api/records/${separate.id}`)
    ).json()) as { record: WorkRecord };
    expect(currentSeparate.record).toEqual(separate);
    const batch = await env.DB.prepare(
      "SELECT undone_at FROM import_batches WHERE id=? AND owner_id=?",
    )
      .bind(replacement.batchId, "local-manav")
      .first<{ undone_at: string | null }>();
    expect(batch?.undone_at).toBeNull();
    const source = await env.DB.prepare(
      "SELECT batch_id FROM import_sources WHERE owner_id=? AND source=? AND source_id=?",
    )
      .bind("local-manav", payload.source, "resume")
      .first<{ batch_id: string }>();
    expect(source?.batch_id).toBe(replacement.batchId);
    const file = await request(`/api/attachments/${replacementFileId}`);
    expect(file.status).toBe(200);
    expect(await file.text()).toBe(replacementPdf);
    const backup = (await (
      await request("/api/export")
    ).json()) as WorkspaceExport;
    expect(backup.attachments).toHaveLength(2);
    expect((await request("/api/restore", "POST", backup)).status).toBe(201);
  });

  it("rejects a whole bad import rather than committing a partial graph", async () => {
    const response = await request("/api/import", "POST", {
      source: "synthetic-invalid",
      records: [
        {
          sourceId: "one",
          hash: "one",
          record: { kind: "note", title: "Would be created" },
        },
        {
          sourceId: "two",
          hash: "two",
          record: { kind: "note", title: "Bad link", links: ["nonexistent"] },
        },
      ],
    });
    expect(response.status).toBe(400);
    expect(await (await request("/api/records")).json()).toEqual({
      records: [],
    });
    expect(await (await request("/api/import")).json()).toEqual({
      batches: [],
    });
  });

  it("round-trips links, revisions, files, preferences and trash through a versioned backup", async () => {
    const note = await create("Reference");
    const linked = await create("Linked", {
      links: [note.id],
      data: { companyId: note.id },
    });
    await request(`/api/records/${linked.id}`, "PATCH", {
      body: "Edited",
      version: 1,
    });
    const form = new FormData();
    form.set(
      "file",
      new File(["some notes"], "notes.md", { type: "text/markdown" }),
    );
    await request(`/api/records/${linked.id}/attachments`, "POST", form);
    await request(`/api/records/${note.id}`, "DELETE");
    await request("/api/preferences", "PUT", {
      ...DEFAULT_PREFERENCES,
      displayName: "Synthetic display name",
    });
    const backup = (await (
      await request("/api/export")
    ).json()) as WorkspaceExport;
    expect(backup.format).toBe("work-export");
    expect(backup.attachments[0].base64).toBe(btoa("some notes"));
    const restored = (await (
      await request("/api/restore", "POST", backup)
    ).json()) as {
      records: WorkRecord[];
      restored: number;
      attachments: number;
    };
    expect(restored.restored).toBe(2);
    expect(restored.attachments).toBe(1);
    const reference = restored.records.find(
      (record) => record.title === "Reference",
    )!;
    const restoredLink = restored.records.find(
      (record) => record.title === "Linked",
    )!;
    expect(reference.deletedAt).not.toBeNull();
    expect(restoredLink.links).toEqual([reference.id]);
    expect(restoredLink.data.companyId).toBe(reference.id);
    const revisions = (await (
      await request(`/api/records/${restoredLink.id}/revisions`)
    ).json()) as { revisions: { version: number }[] };
    expect(revisions.revisions.map((revision) => revision.version)).toEqual([
      2, 1,
    ]);
    const repeat = await (await request("/api/restore", "POST", backup)).json();
    expect(repeat).toEqual(restored);
  });

  it("retains metadata for files excluded from a backup", async () => {
    const note = await create("File owner");
    const form = new FormData();
    form.set(
      "file",
      new File(["private text"], "missing.md", { type: "text/markdown" }),
    );
    const attachment = (
      (await (
        await request(`/api/records/${note.id}/attachments`, "POST", form)
      ).json()) as { attachment: Attachment }
    ).attachment;
    await create("Applied private role", {
      kind: "application",
      links: [note.id],
      data: {
        assetVersions: [
          {
            assetId: note.id,
            attachmentId: attachment.id,
            version: 1,
            body: "captured",
          },
        ],
      },
    });
    await request(`/api/records/${note.id}`, "PATCH", {
      data: { primaryAttachmentId: attachment.id },
      version: 1,
    });
    const backup = (await (
      await request("/api/export?files=false")
    ).json()) as WorkspaceExport;
    expect(backup.attachments[0].base64).toBeUndefined();
    const restored = (await (
      await request("/api/restore", "POST", backup)
    ).json()) as { records: WorkRecord[]; warnings: string[] };
    expect(restored.warnings[0]).toContain("metadata is retained");
    const files = (await (
      await request(`/api/records/${restored.records[0].id}/attachments`)
    ).json()) as { attachments: Attachment[] };
    expect(files.attachments[0].id).toBe(
      restored.records[0].data.primaryAttachmentId,
    );
    expect(
      (await request(`/api/attachments/${files.attachments[0].id}`)).status,
    ).toBe(404);
  });

  it("deletes only the account owner’s content, files, imports and sessions", async () => {
    const other = await foreignRecord();
    const note = await create();
    const form = new FormData();
    form.set(
      "file",
      new File(["private text"], "private.md", { type: "text/markdown" }),
    );
    const attachment = (
      (await (
        await request(`/api/records/${note.id}/attachments`, "POST", form)
      ).json()) as { attachment: Attachment }
    ).attachment;
    await create("Application with retained file", {
      kind: "application",
      links: [note.id],
      data: {
        assetVersions: [
          {
            assetId: note.id,
            attachmentId: attachment.id,
            version: 1,
            body: "captured",
          },
        ],
      },
    });
    const timestamp = Date.now();
    await env.DB.prepare(
      "INSERT INTO session(id,expires_at,token,created_at,updated_at,user_id) VALUES(?,?,?,?,?,?)",
    )
      .bind(
        "local-session",
        timestamp + 60_000,
        "test-session",
        timestamp,
        timestamp,
        "local-manav",
      )
      .run();
    expect(
      (await request("/api/account/delete", "POST", { confirmation: "wrong" }))
        .status,
    ).toBe(400);
    expect(
      (
        await request("/api/account/delete", "POST", {
          confirmation: "DELETE MY WORKSPACE",
        })
      ).status,
    ).toBe(200);
    expect(
      await env.DB.prepare("SELECT id FROM user WHERE id=?")
        .bind("local-manav")
        .first(),
    ).toBeNull();
    expect(
      await env.DB.prepare("SELECT id FROM session WHERE user_id=?")
        .bind("local-manav")
        .first(),
    ).toBeNull();
    expect(
      await env.DB.prepare("SELECT id FROM records WHERE id=?")
        .bind(note.id)
        .first(),
    ).toBeNull();
    expect(
      await env.FILES.get(`local-manav/${note.id}/${attachment.id}`),
    ).toBeNull();
    expect(
      await env.DB.prepare("SELECT id FROM records WHERE id=?")
        .bind(other.id)
        .first(),
    ).not.toBeNull();
    expect(
      await env.DB.prepare("SELECT id FROM records_fts WHERE owner_id=?")
        .bind("local-manav")
        .first(),
    ).toBeNull();
  });

  it("requires trash before permanent deletion and removes linked IDs from live records", async () => {
    const note = await create();
    const linked = await create("Link", { links: [note.id] });
    expect(
      (await request(`/api/records/${note.id}/permanent`, "DELETE")).status,
    ).toBe(409);
    await request(`/api/records/${note.id}`, "DELETE");
    expect(
      (await request(`/api/records/${note.id}/permanent`, "DELETE")).status,
    ).toBe(200);
    expect((await request(`/api/records/${note.id}/revisions`)).status).toBe(
      404,
    );
    expect(
      (
        (await (await request(`/api/records/${linked.id}`)).json()) as {
          record: WorkRecord;
        }
      ).record.links,
    ).toEqual([]);
  });
});
