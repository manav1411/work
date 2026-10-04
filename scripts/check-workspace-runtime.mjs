import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";

// Run the built Worker in workerd with only synthetic records and a public stats fixture.
const stats = {
  username: "runtime-solver",
  profile: { userAvatar: null, ranking: null },
  solved: [{ difficulty: "All", count: 3 }],
  totalQuestions: [{ difficulty: "All", count: 100 }],
  calendar: { submissions: {} },
  recent: [],
  solvedDays: { 1785456000: [{ title: "Two Sum", titleSlug: "two-sum" }] },
};
let statsState = "valid";
const outbound = [];
const miniflare = new Miniflare(
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
      OWNER_GITHUB_LOGIN: "synthetic-owner",
      APP_ORIGIN: "http://localhost",
      BETTER_AUTH_SECRET: "synthetic-auth-secret-for-runtime-check",
    },
    outboundService: async (request) => {
      const url = new URL(request.url);
      outbound.push(`${request.method} ${url.origin}${url.pathname}`);
      assert.equal(url.origin, "https://manavdodia.com");
      assert.equal(url.pathname, "/api/leetcode");
      assert.equal(request.method, "GET");
      assert.equal(url.searchParams.get("username"), "runtime-solver");
      assert.equal(request.headers.has("Cookie"), false);
      assert.equal(request.headers.has("Authorization"), false);
      if (statsState === "unavailable")
        return Response.json({}, { status: 503 });
      return Response.json(
        statsState === "malformed"
          ? { ...stats, username: "wrong-account" }
          : stats,
      );
    },
  }),
);

async function send(path, method = "GET", body, headers = {}) {
  const raw =
    body instanceof FormData ||
    body instanceof Uint8Array ||
    body instanceof Blob;
  if (body instanceof FormData) {
    const request = new Request(`http://localhost${path}`, {
      method,
      headers: { Origin: "http://localhost", ...headers },
      body,
    });
    return miniflare.dispatchFetch(`http://localhost${path}`, {
      method,
      headers: request.headers,
      body: request.body,
      duplex: "half",
    });
  }
  return miniflare.dispatchFetch(`http://localhost${path}`, {
    method,
    headers: {
      ...(method === "GET" ? {} : { Origin: "http://localhost" }),
      ...(body === undefined || raw
        ? {}
        : { "Content-Type": "application/json" }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: raw ? body : JSON.stringify(body) }),
  });
}
async function api(path, method = "GET", body, headers) {
  const response = await send(path, method, body, headers);
  const value = await response.json();
  return { status: response.status, value };
}
async function create(kind, title, data = {}, body = "") {
  const result = await api("/api/records", "POST", { kind, title, data, body });
  assert.equal(result.status, 201, JSON.stringify(result.value));
  return result.value.record;
}
async function insertRecord(
  db,
  owner,
  id,
  kind,
  title,
  data,
  body = "Preserved private text",
) {
  const at = "2026-10-01T00:00:00.000Z";
  await db
    .prepare(
      "INSERT INTO records(id,owner_id,kind,title,body,tags,links,data,version,created_at,updated_at) VALUES(?,?,?,?,?,'[]','[]',?,1,?,?)",
    )
    .bind(id, owner, kind, title, body, JSON.stringify(data), at, at)
    .run();
}
function readArchive(bytes) {
  const decoder = new TextDecoder();
  const entries = new Map();
  let offset = 0;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const path = decoder.decode(header.subarray(0, 100)).split("\0")[0];
    const size = Number.parseInt(
      decoder.decode(header.subarray(124, 136)).split("\0")[0].trim(),
      8,
    );
    assert.equal(Number.isSafeInteger(size), true);
    entries.set(path, { offset: offset + 512, size });
    offset += 512 + size + ((512 - (size % 512)) % 512);
  }
  const entry = entries.get("work-manifest.json");
  assert.ok(entry);
  return {
    manifest: JSON.parse(
      decoder.decode(bytes.subarray(entry.offset, entry.offset + entry.size)),
    ),
    entries,
  };
}

try {
  const config = JSON.parse(readFileSync("dist/work/wrangler.json", "utf8"));
  assert.equal(
    config.triggers?.crons?.length ?? 0,
    0,
    "Retired connections have no scheduled provider jobs",
  );
  const db = await miniflare.getD1Database("DB");
  const files = await miniflare.getR2Bucket("FILES");
  const migrations = readdirSync("migrations")
    .filter((file) => /^\d+.*\.sql$/.test(file))
    .sort();
  const migrate = async (names) => {
    const text = names
      .map((name) => readFileSync(resolve("migrations", name), "utf8"))
      .join("\n");
    if (text) await db.exec(text.replace(/--[^\n]*/g, "").replace(/\n/g, " "));
  };
  await migrate(migrations.filter((name) => Number(name.slice(0, 4)) <= 4));
  const identity = await api("/api/session");
  assert.equal(identity.status, 200);
  const owner = identity.value.user.id;
  const legacyCompany = "11111111-1111-4111-8111-111111111111";
  const legacyApplication = "22222222-2222-4222-8222-222222222222";
  const legacyNote = "33333333-3333-4333-8333-333333333333";
  const legacyFile = "44444444-4444-4444-8444-444444444444";
  await insertRecord(
    db,
    owner,
    legacyCompany,
    "company",
    "Retained company",
    {},
  );
  await insertRecord(
    db,
    owner,
    legacyApplication,
    "application",
    "Retained application",
    { companyId: legacyCompany, stage: "Applied" },
  );
  await insertRecord(db, owner, legacyNote, "note", "Retained import", {
    connectorSource: { provider: "notion", available: true },
  });
  await files.put(`${owner}/${legacyNote}/${legacyFile}`, "retained", {
    httpMetadata: { contentType: "text/plain" },
  });
  await db
    .prepare(
      "INSERT INTO attachments(id,owner_id,record_id,object_key,filename,content_type,size,created_at) VALUES(?,?,?,?,?,'text/plain',8,?)",
    )
    .bind(
      legacyFile,
      owner,
      legacyNote,
      `${owner}/${legacyNote}/${legacyFile}`,
      "retained.txt",
      "2026-10-01T00:00:00.000Z",
    )
    .run();
  for (const provider of ["notion", "leetcode"]) {
    await db
      .prepare(
        "INSERT INTO connector_connections(id,owner_id,provider,account_id,label,status,config,credential,created_at,next_sync_at) VALUES(?,?,?,?,?,'connected',?,?,?,?)",
      )
      .bind(
        `runtime-${provider}`,
        owner,
        provider,
        provider === "leetcode" ? "runtime-solver" : "synthetic-account",
        provider,
        JSON.stringify(
          provider === "leetcode" ? { username: "runtime-solver" } : {},
        ),
        "synthetic-retired-credential",
        "2026-10-01T00:00:00.000Z",
        "2026-10-05T00:00:00.000Z",
      )
      .run();
  }
  await migrate(migrations.filter((name) => Number(name.slice(0, 4)) > 4));
  assert.equal(
    (await api(`/api/records/${legacyNote}`)).value.record.body,
    "Preserved private text",
  );
  assert.equal(
    (await api(`/api/records/${legacyNote}`)).value.record.data.connectorSource
      .detached,
    true,
  );
  assert.equal(
    (await api(`/api/records/${legacyApplication}`)).value.record.data.company,
    "Retained company",
  );
  assert.equal(
    await (await send(`/api/attachments/${legacyFile}`)).text(),
    "retained",
  );
  const retired = await db
    .prepare("SELECT status,credential,next_sync_at FROM connector_connections")
    .all();
  assert.ok(
    retired.results.every(
      (row) =>
        row.status === "disconnected" &&
        row.credential === null &&
        row.next_sync_at === null,
    ),
  );
  assert.equal(
    (await api("/api/preferences")).value.preferences.leetcode,
    "https://leetcode.com/u/runtime-solver/",
  );

  assert.equal(
    (await miniflare.dispatchFetch("https://work.example/api/records")).status,
    401,
  );
  assert.equal(
    (
      await miniflare.dispatchFetch(
        "https://work.example/api/connectors/webhooks/notion",
        {
          method: "POST",
          body: "{}",
          headers: { "Content-Type": "application/json" },
        },
      )
    ).status,
    410,
  );
  assert.equal(
    (
      await api(
        "/api/records",
        "POST",
        { kind: "note", title: "Cross origin" },
        { Origin: "https://other.example" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await api(
        "/api/records",
        "POST",
        { kind: "note", title: "Cross site" },
        { "Sec-Fetch-Site": "cross-site" },
      )
    ).status,
    403,
  );
  const beforeRetired = outbound.length;
  for (const path of [
    "/api/connectors",
    "/api/connectors/notion/connect",
    "/api/connectors/github/discover",
    "/api/connectors/overleaf/sync",
    "/api/learning/content",
    "/api/learning/progress",
    "/api/learning/tasks",
    "/api/learning/refresh",
  ])
    assert.equal(
      (
        await api(
          path,
          path.endsWith("connect") || path.endsWith("sync") ? "POST" : "GET",
          path.endsWith("connect") || path.endsWith("sync") ? {} : undefined,
        )
      ).status,
      410,
    );
  assert.equal(
    outbound.length,
    beforeRetired,
    "Retired features make no provider or curriculum requests",
  );

  const preferences = (await api("/api/preferences")).value.preferences;
  assert.equal(
    (await api("/api/preferences", "PUT", { ...preferences, leetcode: "" }))
      .status,
    200,
  );
  assert.equal((await api("/api/learning/stats")).value.configured, false);
  await api("/api/preferences", "PUT", {
    ...preferences,
    leetcode: "https://leetcode.com/u/runtime-solver/",
  });
  const fresh = await api("/api/learning/stats?username=untrusted-user");
  assert.equal(fresh.status, 200, JSON.stringify(fresh.value));
  assert.equal(fresh.value.username, "runtime-solver");
  assert.equal(fresh.value.source.stale, false);
  const requestsAtCache = outbound.length;
  assert.equal((await api("/api/learning/stats")).value.source.stale, false);
  assert.equal(outbound.length, requestsAtCache);
  await db
    .prepare(
      "UPDATE learning_source_cache SET fetched_at='2000-01-01T00:00:00.000Z' WHERE owner_id=? AND source_key='stats:runtime-solver'",
    )
    .bind(owner)
    .run();
  for (const state of ["unavailable", "malformed"]) {
    statsState = state;
    const stale = await api("/api/learning/stats");
    assert.equal(stale.status, 200);
    assert.equal(stale.value.source.stale, true);
    assert.deepEqual(stale.value.data.solvedDays, stats.solvedDays);
  }
  statsState = "valid";
  assert.equal((await api("/api/learning/stats")).value.source.stale, false);

  const radar = await create("company", "Runtime radar", {
    radar: true,
    website: "https://example.com",
    reviewDate: "2030-10-01",
  });
  const step = "runtime-assessment-step";
  const application = await create("application", "Runtime role", {
    companyId: radar.id,
    company: radar.title,
    applicationStatus: "In progress",
    applicationDate: "2026-10-05",
    role: "Software engineer",
    recruitmentSteps: [
      {
        id: "runtime-submission",
        title: "Application",
        kind: "submission",
        state: "Completed",
        date: "2026-10-05",
      },
      {
        id: step,
        title: "Assessment",
        kind: "assessment",
        state: "Current",
        date: "2030-10-07",
      },
    ],
  });
  const interview = await create("interview", "Runtime appointment", {
    applicationId: application.id,
    stepId: step,
    startsAt: "2030-10-07T01:00:00Z",
    timezone: "Australia/Melbourne",
    status: "Scheduled",
    type: "Technical",
  });
  const story = await create("story", "Runtime STAR", {
    situation: "An actual problem",
    task: "My responsibility",
    action: "What I did",
    result: "Observed outcome",
  });
  const prep = await create(
    "note",
    "Runtime preparation",
    {
      category: "interview-preparation",
      interviewId: interview.id,
      applicationId: application.id,
      storyIds: [story.id],
    },
    "Preparation notes",
  );
  const topic = await create("topic", "Runtime topic", {
    category: "learn-topic",
    track: "backend",
  });
  await create("resource", "Runtime reading", {
    category: "content-resource",
    scope: "learn",
    topicId: topic.id,
    url: "https://example.com/reading",
  });
  const tab = await create("note", "Runtime custom tab", {
    category: "interview-tab",
  });
  await create(
    "note",
    "Runtime tab notes",
    { category: "content-section", scope: "interviews", tabId: tab.id },
    "Private notes",
  );
  assert.equal(
    (
      await api("/api/records", "POST", {
        kind: "note",
        title: "Invalid scoped note",
        data: {
          category: "content-section",
          scope: "learn",
          topicId: radar.id,
        },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await api("/api/records", "POST", {
        kind: "interview",
        title: "Invalid appointment",
        data: { applicationId: application.id, stepId: "missing" },
      })
    ).status,
    400,
  );
  const direction = await create("path", "Runtime direction", {
    category: "direction",
    status: "Exploring",
  });
  const goalInput = {
    title: "Runtime roadmap goal",
    directionId: direction.id,
    measure: "problems",
    scope: "all",
    target: 10,
    unit: "problems",
    targetDate: "2030-12-31",
  };
  const goal = await api("/api/goals", "POST", goalInput, {
    "Idempotency-Key": "runtime-goal-v1",
  });
  assert.equal(goal.status, 201, JSON.stringify(goal.value));
  assert.equal(
    (
      await api("/api/goals", "POST", goalInput, {
        "Idempotency-Key": "runtime-goal-v1",
      })
    ).value.goal.id,
    goal.value.goal.id,
  );
  const checkpoint = {
    value: 3,
    at: new Date(Date.now() - 1000).toISOString(),
  };
  const checkpointed = await api(
    `/api/goals/${goal.value.goal.id}/checkpoint`,
    "POST",
    checkpoint,
  );
  assert.equal(checkpointed.status, 200);
  assert.equal(
    (
      await api(
        `/api/goals/${goal.value.goal.id}/checkpoint`,
        "POST",
        checkpoint,
      )
    ).value.goal.version,
    checkpointed.value.goal.version,
  );

  const document = await create("asset", "Runtime document", {
    type: "resume",
    documentDefault: true,
    sourceUrl: "https://www.overleaf.com/project/runtime",
  });
  let currentDocument = document;
  const pdf = new Uint8Array(7 * 1024 * 1024);
  pdf.set(new TextEncoder().encode("%PDF-1.7\n"));
  for (let index = 0; index < 44; index++) {
    const data = new FormData();
    const large = index < 3;
    data.append(
      "file",
      new Blob([large ? pdf : new TextEncoder().encode(`tiny ${index}`)], {
        type: large ? "application/pdf" : "text/plain",
      }),
      large ? `copy-${index}.pdf` : `tiny-${index}.txt`,
    );
    const uploaded = await api(
      `/api/records/${document.id}/attachments`,
      "POST",
      data,
    );
    assert.equal(uploaded.status, 201, JSON.stringify(uploaded.value));
    if (index === 2) {
      const selected = await api(`/api/records/${document.id}`, "PATCH", {
        version: currentDocument.version,
        data: {
          ...currentDocument.data,
          primaryAttachmentId: uploaded.value.attachment.id,
        },
      });
      assert.equal(selected.status, 200);
      currentDocument = selected.value.record;
      const inline = await send(
        `/api/attachments/${uploaded.value.attachment.id}`,
      );
      assert.equal(inline.headers.get("X-Frame-Options"), "SAMEORIGIN");
      await inline.arrayBuffer();
    }
  }
  const archiveResponse = await send("/api/backup");
  assert.equal(archiveResponse.status, 200);
  assert.equal(
    archiveResponse.headers.get("content-type"),
    "application/x-tar",
  );
  const bytes = new Uint8Array(await archiveResponse.arrayBuffer());
  assert.ok(
    bytes.length > 20 * 1024 * 1024,
    "The streamed backup exceeds the retired JSON bundle limit",
  );
  const { manifest, entries } = readArchive(bytes);
  assert.equal(manifest.format, "work-backup");
  assert.equal(manifest.version, 3);
  assert.ok(manifest.attachments.length > 40);
  assert.equal(
    JSON.stringify(manifest).includes("synthetic-retired-credential"),
    false,
  );
  const start = await api("/api/backup/restores", "POST", { manifest });
  assert.equal(start.status, 201, JSON.stringify(start.value));
  const restoreId = start.value.restoreId;
  assert.equal(
    (await api(`/api/backup/restores/${restoreId}/commit`, "POST", {})).status,
    409,
  );
  assert.equal(
    (
      await api(
        `/api/backup/restores/${restoreId}/files/not-in-manifest`,
        "PUT",
        new Uint8Array([1]),
        { "Content-Type": "text/plain" },
      )
    ).status,
    400,
  );
  const first = manifest.attachments.find((file) => !file.missing);
  async function stage(file) {
    const entry = entries.get(file.path);
    assert.ok(entry);
    return api(
      `/api/backup/restores/${restoreId}/files/${encodeURIComponent(file.id)}`,
      "PUT",
      bytes.subarray(entry.offset, entry.offset + entry.size),
      { "Content-Type": file.contentType },
    );
  }
  assert.equal((await stage(first)).status, 200);
  const retry = await api("/api/backup/restores", "POST", { manifest });
  assert.equal(retry.value.restoreId, restoreId);
  assert.deepEqual(retry.value.uploaded, [first.id]);
  for (const file of manifest.attachments.filter(
    (file) => !file.missing && file.id !== first.id,
  ))
    assert.equal((await stage(file)).status, 200);
  const committed = await api(
    `/api/backup/restores/${restoreId}/commit`,
    "POST",
    {},
  );
  assert.equal(committed.status, 201, JSON.stringify(committed.value));
  assert.equal(committed.value.restored, manifest.records.length);
  assert.equal(committed.value.attachments, manifest.attachments.length);
  const restoredApplication = committed.value.records.find(
    (record) => record.title === application.title,
  );
  const restoredInterview = committed.value.records.find(
    (record) => record.title === interview.title,
  );
  const restoredPrep = committed.value.records.find(
    (record) => record.title === prep.title,
  );
  const restoredStory = committed.value.records.find(
    (record) => record.title === story.title,
  );
  const restoredDirection = committed.value.records.find(
    (record) => record.title === direction.title,
  );
  const restoredDocument = committed.value.records.find(
    (record) => record.title === document.title,
  );
  assert.notEqual(restoredApplication.id, application.id);
  assert.notEqual(restoredInterview.data.stepId, step);
  assert.equal(restoredInterview.data.applicationId, restoredApplication.id);
  assert.ok(
    restoredApplication.data.recruitmentSteps.some(
      (step) => step.id === restoredInterview.data.stepId,
    ),
  );
  assert.equal(restoredPrep.data.interviewId, restoredInterview.id);
  assert.deepEqual(restoredPrep.data.storyIds, [restoredStory.id]);
  assert.equal(
    committed.value.goals.find((item) => item.title === goalInput.title)
      .directionId,
    restoredDirection.id,
  );
  const restoredFile = await db
    .prepare("SELECT record_id FROM attachments WHERE id=? AND owner_id=?")
    .bind(restoredDocument.data.primaryAttachmentId, owner)
    .first();
  assert.equal(restoredFile.record_id, restoredDocument.id);
  assert.deepEqual(
    (await api(`/api/backup/restores/${restoreId}/commit`, "POST", {})).value,
    {
      restored: committed.value.restored,
      attachments: committed.value.attachments,
      warnings: committed.value.warnings,
    },
  );
  const repeated = await api("/api/backup/restores", "POST", { manifest });
  assert.equal(repeated.value.committed.restored, committed.value.restored);

  const foreignOwner = "runtime-foreign-owner";
  await db
    .prepare(
      "INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES(?,?,?,1,?,?)",
    )
    .bind(
      foreignOwner,
      "Other",
      "other@example.invalid",
      Date.now(),
      Date.now(),
    )
    .run();
  const foreignSession = "55555555-5555-4555-8555-555555555555";
  await db
    .prepare(
      "INSERT INTO backup_restore_sessions(id,owner_id,manifest_hash,payload,created_at,expires_at) VALUES(?,?,?,'{}',?,?)",
    )
    .bind(
      foreignSession,
      foreignOwner,
      "foreign-hash",
      new Date().toISOString(),
      "2030-01-01T00:00:00.000Z",
    )
    .run();
  assert.equal(
    (await api(`/api/backup/restores/${foreignSession}/commit`, "POST", {}))
      .status,
    404,
  );
  assert.equal(
    (
      await api(
        `/api/backup/restores/${foreignSession}/files/${first.id}`,
        "PUT",
        new Uint8Array([1]),
        { "Content-Type": "text/plain" },
      )
    ).status,
    404,
  );
  assert.equal(
    (await api(`/api/backup/restores/${foreignSession}`, "DELETE")).status,
    404,
  );
  const foreignNote = "66666666-6666-4666-8666-666666666666";
  await insertRecord(db, foreignOwner, foreignNote, "note", "Foreign note", {});
  assert.equal((await api(`/api/records/${foreignNote}`)).status, 404);
  assert.ok(
    (await api(`/api/records?owner_id=${foreignOwner}`)).value.records.every(
      (record) => record.id !== foreignNote,
    ),
  );
  assert.ok(
    outbound.every(
      (entry) => entry === "GET https://manavdodia.com/api/leetcode",
    ),
  );
  console.log(
    "Built Worker checks passed: retained data/auth/origin boundaries, typed scopes/goals/stats, retired connections/curriculum, >20 MB streamed archive, >40-file staged restore/retry/idempotency, remapped interview/story/direction/file relations and owner isolation.",
  );
} finally {
  await miniflare.dispose();
}
