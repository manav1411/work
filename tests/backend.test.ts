import { drainFileCleanup } from "../worker/transfer";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { app } from "../worker";
import type { Env } from "../worker/env";
import { DEFAULT_PREFERENCES, type WorkRecord } from "../shared/model";
import {
  commonRecruitmentProcess,
  selectApplicationStatus,
  removeRecruitmentStep,
} from "../shared/applications";
import { EMPTY_GOAL } from "../shared/goals";
import { makeRecord } from "../src/lib/demo";
import {
  MANIFEST_PATH,
  readTarHeader,
  tarPadding,
  type WorkspaceManifest,
} from "../shared/transfer";
let runtime: Miniflare, env: Env, epoch: string;
async function send(
  path: string,
  method = "GET",
  body?: unknown,
  headers: HeadersInit = {},
) {
  const h = new Headers(headers);
  if (!h.has("X-Workspace-Epoch")) h.set("X-Workspace-Epoch", epoch ?? "");
  const raw = body instanceof FormData || body instanceof Uint8Array;
  if (body !== undefined && !raw) h.set("Content-Type", "application/json");
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: h,
      body:
        body === undefined
          ? undefined
          : raw
            ? (body as BodyInit)
            : JSON.stringify(body),
    }),
    env,
    {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as unknown as ExecutionContext,
  );
}
async function json(path: string, method = "GET", body?: unknown) {
  const response = await send(path, method, body);
  return {
    status: response.status,
    data: (await response.json()) as Record<string, unknown>,
  };
}
async function create(input: Record<string, unknown> = {}) {
  const response = await send("/api/records", "POST", {
    kind: "note",
    title: "Current note",
    data: { category: "interview-tab" },
    ...input,
  });
  expect(response.status, await response.clone().text()).toBe(201);
  return ((await response.json()) as { record: WorkRecord }).record;
}
async function workspace(): Promise<{
  manifest: WorkspaceManifest;
  files: Map<string, Uint8Array>;
}> {
  const response = await send("/api/workspace");
  expect(response.status, await response.clone().text()).toBe(200);
  const bytes = new Uint8Array(await response.arrayBuffer()),
    files = new Map<string, Uint8Array>();
  let offset = 0;
  let manifest: WorkspaceManifest | undefined;
  while (offset < bytes.length) {
    const header = readTarHeader(bytes.subarray(offset, offset + 512));
    offset += 512;
    if (!header) break;
    const data = bytes.slice(offset, offset + header.size);
    offset += header.size + tarPadding(header.size);
    if (header.path === MANIFEST_PATH)
      manifest = JSON.parse(new TextDecoder().decode(data));
    else files.set(header.path, data);
  }
  return { manifest: manifest!, files };
}
async function start(manifest: WorkspaceManifest) {
  const response = await json("/api/workspace/uploads", "POST", manifest);
  expect(response.status, JSON.stringify(response.data)).toBe(201);
  return response.data.uploadId as string;
}
async function file(record: WorkRecord, contents = "file content") {
  const form = new FormData();
  form.append(
    "file",
    new File([contents], "current.txt", { type: "text/plain" }),
  );
  const response = await json(
    `/api/records/${record.id}/attachments`,
    "POST",
    form,
  );
  expect(response.status, JSON.stringify(response.data)).toBe(201);
  return response.data.attachment as { id: string };
}
beforeAll(async () => {
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("test")}}',
      compatibilityDate: "2026-10-02",
      d1Databases: ["DB"],
      r2Buckets: ["FILES"],
    }),
  );
  env = {
    DB: (await runtime.getD1Database("DB")) as unknown as D1Database,
    FILES: (await runtime.getR2Bucket("FILES")) as unknown as R2Bucket,
    ENVIRONMENT: "local",
    LOCAL_DEV_AUTH: "true",
    ALLOWED_GITHUB_USERS: '[{"login":"synthetic-owner","id":"12345"}]',
    APP_ORIGIN: "http://localhost",
  };
  const sql = ["0001_workspace.sql", "0009_current_workspace.sql"]
    .map((name) =>
      readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"),
    )
    .join("\n");
  await env.DB.exec(sql.replace(/--[^\n]*/g, "").replace(/\n/g, " "));
}, 30000);
afterAll(async () => runtime?.dispose(), 30000);
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM user"),
    env.DB.prepare("DELETE FROM rate_limits"),
    env.DB.prepare("DELETE FROM file_cleanup"),
  ]);
  const objects = await env.FILES.list();
  for (const object of objects.objects) await env.FILES.delete(object.key);
  await send("/api/session");
  epoch = (await json("/api/records")).data.epoch as string;
});
describe("current workspace and replacement", () => {
  it("rejects retired schemas and endpoints and stores no revision or trash tables", async () => {
    for (const path of [
      "/api/backup",
      "/api/export",
      "/api/import",
      "/api/connectors",
      "/api/goals/legacy",
      "/api/learning/content",
    ]) {
      expect((await send(path)).status).toBe(404);
    }
    for (const input of [
      { kind: "contact" },
      { kind: "application", data: { stage: "Applied" } },
      { kind: "note", data: { category: "content-section" } },
      { kind: "asset", data: { type: "cover-letter" } },
    ])
      expect(
        (await send("/api/records", "POST", { title: "Old", ...input })).status,
      ).toBe(400);
    const tables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table'",
    ).all<{ name: string }>();
    expect(tables.results.map((row) => row.name)).not.toContain(
      "record_revisions",
    );
    expect(
      (
        await env.DB.prepare("PRAGMA table_info(records)").all<{
          name: string;
        }>()
      ).results.map((row) => row.name),
    ).not.toContain("deleted_at");
  });
  it("keeps current edits, search and retries without storing old response content", async () => {
    const record = await create();
    const patch = { version: 1, body: "Searchable current text" };
    const response = await send(`/api/records/${record.id}`, "PATCH", patch, {
      "Idempotency-Key": "current-save-request",
    });
    expect(response.status).toBe(200);
    expect(
      (await send(`/api/records/${record.id}`, "PATCH", patch)).status,
    ).toBe(409);
    expect(
      (
        await send(`/api/records/${record.id}`, "PATCH", {
          version: 2,
          body: "Latest text",
        })
      ).status,
    ).toBe(200);
    const retry = await send(`/api/records/${record.id}`, "PATCH", patch, {
      "Idempotency-Key": "current-save-request",
    });
    expect(((await retry.json()) as { record: WorkRecord }).record.body).toBe(
      "Latest text",
    );
    const receipt = await env.DB.prepare(
      "SELECT response FROM idempotency",
    ).first<{ response: string }>();
    expect(receipt!.response).not.toContain("Searchable current text");
    expect((await json("/api/search?q=Latest")).data.records).toHaveLength(1);
  });
  it("permanently removes a process step and its appointments, preparation, and files", async () => {
    const draft = makeRecord({
      kind: "application",
      title: "Application",
      data: {
        processVersion: 2,
        applicationStatus: "Saved",
        recruitmentSteps: (() => {
          const steps = commonRecruitmentProcess();
          return [
            steps[0],
            {
              id: crypto.randomUUID(),
              title: "Interview",
              kind: "interview",
              state: "Planned",
              date: "",
            },
            steps[1],
          ];
        })(),
      },
    });
    const data = selectApplicationStatus(draft, "Applied");
    const application = await create({ kind: "application", data });
    const step = (
      application.data.recruitmentSteps as { id: string; kind: string }[]
    ).find((step) => step.kind === "interview")!;
    const interview = await create({
      kind: "interview",
      data: {
        appointmentVersion: 2,
        applicationId: application.id,
        stepId: step.id,
        startsAt: "2026-11-01T12:00:00Z",
        timezone: "UTC",
        status: "Scheduled",
      },
    });
    const prep = await create({
      data: {
        category: "interview-preparation",
        interviewId: interview.id,
        applicationId: application.id,
      },
    });
    const attachment = await file(prep);
    const response = await send(`/api/records/${application.id}`, "PATCH", {
      version: 1,
      data: removeRecruitmentStep(application, step.id),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    expect((await send(`/api/records/${interview.id}`)).status).toBe(404);
    expect((await send(`/api/records/${prep.id}`)).status).toBe(404);
    await drainFileCleanup(env);
    expect((await send(`/api/attachments/${attachment.id}`)).status).toBe(404);
  });
  it("replaces the entire workspace with its full file package and preserves authentication", async () => {
    const record = await create({
        kind: "asset",
        title: "Exported document",
        data: { type: "document" },
      }),
      attachment = await file(record, "Round trip bytes");
    const goal = await json("/api/goals", "POST", {
      ...EMPTY_GOAL,
      title: "Current goal",
    });
    expect(goal.status).toBe(201);
    await send(`/api/records/${record.id}`, "PATCH", {
      version: 1,
      data: { ...record.data, primaryAttachmentId: attachment.id },
    });
    const pkg = await workspace();
    const added = await create({ title: "Must disappear" });
    const uploadId = await start(pkg.manifest);
    expect(
      (await send(`/api/workspace/uploads/${uploadId}/commit`, "POST", {}))
        .status,
    ).toBe(409);
    expect((await send(`/api/records/${added.id}`)).status).toBe(200);
    for (const entry of pkg.manifest.attachments)
      expect(
        (
          await send(
            `/api/workspace/uploads/${uploadId}/files/${entry.id}`,
            "PUT",
            pkg.files.get(entry.path),
            { "Content-Type": "application/octet-stream" },
          )
        ).status,
      ).toBe(200);
    const committed = await json(
      `/api/workspace/uploads/${uploadId}/commit`,
      "POST",
      {},
    );
    expect(committed.status, JSON.stringify(committed.data)).toBe(200);
    expect(
      (await json(`/api/workspace/uploads/${uploadId}/commit`, "POST", {}))
        .data,
    ).toEqual(committed.data);
    const current = await json("/api/records");
    const records = current.data.records as WorkRecord[];
    expect(records).toHaveLength(1);
    expect(records[0].id).not.toBe(record.id);
    expect(
      (await send(`/api/attachments/${records[0].data.primaryAttachmentId}`))
        .status,
    ).toBe(200);
    expect(
      await (
        await send(`/api/attachments/${records[0].data.primaryAttachmentId}`)
      ).text(),
    ).toBe("Round trip bytes");
    expect((await json("/api/goals")).data.goals).toHaveLength(1);
    expect((await json("/api/session")).data.user).toBeTruthy();
    expect(
      (
        await send("/api/records", "POST", {
          kind: "note",
          title: "Stale create",
          data: { category: "interview-tab" },
        })
      ).status,
    ).toBe(409);
    epoch = current.data.epoch as string;
    expect(
      (
        await send("/api/records", "POST", {
          kind: "note",
          title: "Fresh create",
          data: { category: "interview-tab" },
        })
      ).status,
    ).toBe(201);
  });
  it("leaves the current workspace unchanged if it changes during upload", async () => {
    const original = await create(),
      pkg = await workspace(),
      uploadId = await start(pkg.manifest);
    await send(`/api/records/${original.id}`, "PATCH", {
      version: 1,
      title: "Changed during upload",
    });
    expect(
      (await send(`/api/workspace/uploads/${uploadId}/commit`, "POST", {}))
        .status,
    ).toBe(409);
    expect(
      (await json(`/api/records/${original.id}`)).data.record,
    ).toMatchObject({ title: "Changed during upload" });
  });
  it("rejects foreign records/files and invalid package references", async () => {
    const foreign = makeRecord({
      kind: "note",
      title: "Foreign",
      data: { category: "interview-tab" },
    });
    const manifest: WorkspaceManifest = {
      format: "work-workspace",
      version: 1,
      exportedAt: new Date().toISOString(),
      records: [{ ...foreign, links: ["missing-id"] }],
      goals: [],
      preferences: { ...DEFAULT_PREFERENCES },
      attachments: [],
    };
    expect(
      (await send("/api/workspace/uploads", "POST", manifest)).status,
    ).toBe(400);
    expect(
      (await send("/api/workspace/uploads/foreign-id/commit", "POST", {}))
        .status,
    ).toBe(404);
    expect((await send("/api/attachments/foreign-id")).status).toBe(404);
  });
  it("deletes an account and every workspace row without triggering foreign key errors", async () => {
    const record = await create();
    await file(record);
    await json("/api/goals", "POST", { ...EMPTY_GOAL, title: "Delete me" });
    expect(
      (
        await send("/api/account/delete", "POST", {
          confirmation: "DELETE MY WORKSPACE",
        })
      ).status,
    ).toBe(200);
    expect(
      (await env.DB.prepare("SELECT count(*) n FROM records").first<{
        n: number;
      }>())!.n,
    ).toBe(0);
    await drainFileCleanup(env);
    expect((await env.FILES.list()).objects).toHaveLength(0);
  });
});
