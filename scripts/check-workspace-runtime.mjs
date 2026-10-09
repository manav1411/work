import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
const runtime = new Miniflare(
  convertV4MiniflareOptions({
    modules: [
      "index.js",
      ...readdirSync("dist/work/assets")
        .filter((file) => file.endsWith(".js"))
        .map((file) => `assets/${file}`),
    ].map((file) => ({ type: "ESModule", path: resolve("dist/work", file) })),
    modulesRoot: resolve("dist/work"),
    compatibilityDate: "2026-10-02",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: ["DB"],
    r2Buckets: ["FILES"],
    bindings: {
      ENVIRONMENT: "local",
      LOCAL_DEV_AUTH: "true",
      ALLOWED_GITHUB_USERS: '[{"login":"synthetic-owner","id":"12345"}]',
      APP_ORIGIN: "http://localhost",
      BETTER_AUTH_SECRET: "synthetic-auth-secret-for-runtime-check",
    },
  }),
);
let epoch = "";
async function send(path, method = "GET", body, extra = {}) {
  const raw = body instanceof Uint8Array || body instanceof FormData;
  const request = new Request(`http://localhost${path}`, {
    method,
    headers: {
      "X-Workspace-Epoch": epoch,
      ...(method === "GET" ? {} : { Origin: "http://localhost" }),
      ...(body !== undefined && !raw
        ? { "Content-Type": "application/json" }
        : {}),
      ...extra,
    },
    ...(body === undefined ? {} : { body: raw ? body : JSON.stringify(body) }),
  });
  return runtime.dispatchFetch(request.url, {
    method,
    headers: request.headers,
    body: request.body,
    ...(request.body ? { duplex: "half" } : {}),
  });
}
async function api(path, method = "GET", body) {
  const response = await send(path, method, body);
  return { status: response.status, value: await response.json() };
}
async function create(kind, title, data, body = "") {
  const result = await api("/api/records", "POST", { kind, title, data, body });
  assert.equal(result.status, 201, JSON.stringify(result.value));
  return result.value.record;
}
function readArchive(bytes) {
  const entries = new Map();
  for (let offset = 0; offset < bytes.length;) {
    const header = bytes.subarray(offset, offset + 512);
    offset += 512;
    if (header.every((byte) => byte === 0)) break;
    const read = (start, length) =>
      new TextDecoder()
        .decode(header.subarray(start, start + length))
        .split("\0")[0];
    const size = Number.parseInt(read(124, 12), 8);
    entries.set(read(0, 100), bytes.slice(offset, offset + size));
    offset += size + ((512 - (size % 512)) % 512);
  }
  return entries;
}
try {
  const db = await runtime.getD1Database("DB"),
    files = await runtime.getR2Bucket("FILES");
  for (const migration of [
    "0001_workspace.sql",
    "0009_current_workspace.sql",
    "0010_goal_actions.sql",
  ]) {
    const sql = readFileSync(`migrations/${migration}`, "utf8")
      .replace(/--[^\n]*/g, "")
      .replace(/\n/g, " ");
    await db.exec(sql);
  }
  assert.equal((await api("/api/health")).status, 200);
  assert.ok((await api("/api/session")).value.user);
  epoch = (await api("/api/records")).value.epoch;
  const document = await create("asset", "Full file round trip", {
    type: "document",
  });
  const form = new FormData();
  form.append(
    "file",
    new File(["Current text bytes"], "current.txt", { type: "text/plain" }),
  );
  const upload = await api(
    `/api/records/${document.id}/attachments`,
    "POST",
    form,
  );
  assert.equal(upload.status, 201, JSON.stringify(upload.value));
  const saved = await api(`/api/records/${document.id}`, "PATCH", {
    version: 1,
    data: { type: "document", primaryAttachmentId: upload.value.attachment.id },
  });
  assert.equal(saved.status, 200);
  // The archive can exceed a single-request file limit, and files upload independently.
  for (let index = 0; index < 2; index++) {
    const bytes = new Uint8Array(9 * 1024 * 1024).fill(65 + index),
      id = crypto.randomUUID(),
      key = `local-manav/runtime/${id}`;
    await files.put(key, bytes, {
      httpMetadata: { contentType: "text/plain" },
    });
    await db
      .prepare(
        "INSERT INTO attachments(id,owner_id,record_id,object_key,filename,content_type,size,created_at) VALUES(?,?,?,?,?,?,?,?)",
      )
      .bind(
        id,
        "local-manav",
        document.id,
        key,
        `large-${index}.txt`,
        "text/plain",
        bytes.length,
        new Date().toISOString(),
      )
      .run();
  }
  const archive = await send("/api/workspace");
  assert.equal(archive.status, 200);
  const entries = readArchive(new Uint8Array(await archive.arrayBuffer()));
  const manifest = JSON.parse(
    new TextDecoder().decode(entries.get("workspace.json")),
  );
  assert.equal(manifest.format, "work-workspace");
  assert.equal(manifest.attachments.length, 3);
  assert.equal(manifest.records.length, 1);
  const disposable = await create("note", "Replace me", {
    category: "interview-tab",
  });
  const begin = await api("/api/workspace/uploads", "POST", manifest);
  assert.equal(begin.status, 201, JSON.stringify(begin.value));
  const uploadId = begin.value.uploadId;
  assert.equal(
    (await api(`/api/workspace/uploads/${uploadId}/commit`, "POST", {})).status,
    409,
  );
  assert.equal((await api(`/api/records/${disposable.id}`)).status, 200);
  for (const file of manifest.attachments) {
    const result = await send(
      `/api/workspace/uploads/${uploadId}/files/${file.id}`,
      "PUT",
      entries.get(file.path),
      { "Content-Type": "application/octet-stream" },
    );
    assert.equal(result.status, 200, await result.text());
  }
  const commit = await api(
    `/api/workspace/uploads/${uploadId}/commit`,
    "POST",
    {},
  );
  assert.equal(commit.status, 200, JSON.stringify(commit.value));
  assert.deepEqual(
    (await api(`/api/workspace/uploads/${uploadId}/commit`, "POST", {})).value,
    commit.value,
  );
  assert.equal((await api(`/api/records/${disposable.id}`)).status, 404);
  assert.equal(
    (
      await api("/api/records", "POST", {
        kind: "note",
        title: "Stale",
        data: { category: "interview-tab" },
      })
    ).status,
    409,
  );
  const current = await api("/api/records");
  epoch = current.value.epoch;
  assert.equal(current.value.records.length, 1);
  assert.equal(
    await (
      await send(
        `/api/attachments/${current.value.records[0].data.primaryAttachmentId}`,
      )
    ).text(),
    "Current text bytes",
  );
  const native = await create("asset", "Current source", {
    type: "resume",
    nativeDocument: true,
  });
  let oldSource;
  for (let index = 0; index < 2; index++) {
    const result = await api(`/api/latex/${native.id}`, "PUT", {
      expectedVersion: index + 1,
      files: [
        {
          path: "main.tex",
          encoding: "utf8",
          content: `\\documentclass{article}\n\\begin{document}Current ${index}\\end{document}`,
        },
      ],
      mainFile: "main.tex",
      engine: "pdflatex",
    });
    assert.equal(result.status, 200, JSON.stringify(result.value));
    if (index === 0) oldSource = result.value.project.sourceId;
    else assert.notEqual(result.value.project.sourceId, oldSource);
  }
  assert.equal((await send(`/api/attachments/${oldSource}`)).status, 404);
  assert.equal(
    (
      await api(`/api/latex/${native.id}/compile`, "POST", {
        sourceId: oldSource,
      })
    ).status,
    409,
  );
  // A native document's current source also survives a full workspace replacement.
  const firstGoal = await create("path", "Career goal", {
    category: "direction",
    status: "Pursuing",
  });
  const secondGoal = await create("path", "Networking goal", {
    category: "direction",
    status: "Exploring",
  });
  const sharedEvent = await api("/api/goals", "POST", {
    title: "Networking event",
    goalIds: [firstGoal.id, secondGoal.id],
    scheduleKind: "event",
    startDate: "2030-04-01",
    targetDate: "2030-04-01",
  });
  assert.equal(sharedEvent.status, 201, JSON.stringify(sharedEvent.value));
  assert.equal(
    (await api("/api/goals", "POST", { title: "Unlinked action" })).status,
    400,
  );
  assert.equal(
    (
      await api("/api/goals", "POST", {
        ...sharedEvent.value.goal,
        id: undefined,
        version: undefined,
        createdAt: undefined,
        updatedAt: undefined,
        targetDate: "2030-04-02",
      })
    ).status,
    400,
  );
  const nativeEntries = readArchive(
    new Uint8Array(await (await send("/api/workspace")).arrayBuffer()),
  );
  const nativeManifest = JSON.parse(
    new TextDecoder().decode(nativeEntries.get("workspace.json")),
  );
  const nativeBegin = await api(
    "/api/workspace/uploads",
    "POST",
    nativeManifest,
  );
  assert.equal(nativeBegin.status, 201, JSON.stringify(nativeBegin.value));
  for (const file of nativeManifest.attachments) {
    const result = await send(
      `/api/workspace/uploads/${nativeBegin.value.uploadId}/files/${file.id}`,
      "PUT",
      nativeEntries.get(file.path),
      { "Content-Type": "application/octet-stream" },
    );
    assert.equal(result.status, 200, await result.text());
  }
  const nativeCommit = await api(
    `/api/workspace/uploads/${nativeBegin.value.uploadId}/commit`,
    "POST",
    {},
  );
  assert.equal(nativeCommit.status, 200, JSON.stringify(nativeCommit.value));
  const nativeRows = await api("/api/records");
  epoch = nativeRows.value.epoch;
  const transferredNative = nativeRows.value.records.find(
    (record) => record.data.nativeDocument,
  );
  assert.ok(transferredNative);
  const transferredSource = await api(`/api/latex/${transferredNative.id}`);
  assert.equal(transferredSource.status, 200);
  assert.ok(
    transferredSource.value.project.files[0].content.includes("Current 1"),
  );
  const importedActions = (await api("/api/goals")).value.goals;
  assert.equal(importedActions.length, 1);
  assert.equal(importedActions[0].scheduleKind, "event");
  const importedGoals = nativeRows.value.records.filter(
    (record) => record.kind === "path",
  );
  assert.equal(importedGoals.length, 2);
  assert.deepEqual(
    new Set(importedActions[0].goalIds),
    new Set(importedGoals.map((record) => record.id)),
  );
  assert.equal(
    (await api(`/api/records/${importedGoals[0].id}`, "DELETE")).status,
    200,
  );
  assert.equal((await api("/api/goals")).value.goals[0].goalIds.length, 1);
  assert.equal(
    (await api(`/api/records/${importedGoals[1].id}`, "DELETE")).status,
    200,
  );
  assert.equal((await api("/api/goals")).value.goals.length, 0);
  for (const path of [
    "/api/backup",
    "/api/import",
    "/api/export",
    "/api/connectors",
    "/api/learning/content",
    `/api/records/${native.id}/revisions`,
  ])
    assert.equal((await send(path)).status, 404);
  const tables = (
    await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
  ).results.map((row) => row.name);
  assert.ok(!tables.includes("record_revisions"));
  assert.ok(!tables.includes("import_batches"));
  assert.equal(
    (
      await api("/api/account/delete", "POST", {
        confirmation: "DELETE MY WORKSPACE",
      })
    ).status,
    200,
  );
  console.log(
    "Built Worker verified: current schemas, >18 MB full file round trip, atomic replacement, stale-device rejection, permanent deletion, native source pruning, shared action/event links, and account removal.",
  );
} finally {
  await runtime.dispose();
}
