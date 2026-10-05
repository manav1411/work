import {
  downloadBackup,
  beginBackupRestore,
  stageBackupFile,
  commitBackupRestore,
  cancelBackupRestore,
  cleanupOwnerBackupStaging,
} from "./backup";
import { Hono } from "hono";
import { z } from "zod";
import {
  DEFAULT_PREFERENCES,
  type RecordRevision,
  type WorkRecord,
} from "../shared/model";
import { authConfigured, createAuth, resolveSession } from "./auth";
import { ApiError, now, type Env, type Variables } from "./env";
import { recordContractStatements, validateRecordContract } from "./contracts";
import { goalRoutes } from "./goals";
import { goalMigrationRoutes } from "./goal-migration";
import { learningRoutes } from "./learning";
import { latexRoutes } from "./latex";
import { applicationStatusLabel } from '../shared/applications';
import { assertNativeInput, assertProviderPatch } from "./connectors/store";
import { ProviderFailure } from "./connectors/providers";
import {
  applicationFileStatements,
  assertChanged,
  attachmentFromRow,
  bulkInsertLinks,
  bulkInsertRecords,
  detachReferenceStatements,
  fromRow,
  getRecord,
  insertRecord,
  insertLinks,
  newRecord,
  referencePresenceStatements,
  validateDataReferences,
  validateLinks,
  writeRecord,
  updateRecord,
  type AttachmentRow,
  type RecordRow,
} from "./db/records";
import {
  assertFilesNotSubmitted,
  assertRecordFilesNotSubmitted,
  getAttachment,
  saveAttachment,
} from "./files";
import {
  exportWorkspace,
  importRecords,
  restoreWorkspace,
  undoImport,
} from "./import-export";
import {
  checkIdempotency,
  idempotencyStatement,
  raceResponse,
} from "./idempotency";
import {
  filename,
  idempotencyKeySchema,
  MAX_FILE_BYTES,
  MAX_REQUEST_BYTES,
  parse,
  patchSchema,
  preferencesSchema,
  readJson,
  readLimitedBody,
  recordSchema,
  searchExpression,
} from "./validation";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use("*", async (context, next) => {
  const api = new URL(context.req.url).pathname.startsWith("/api/");
  await next();
  context.header("X-Content-Type-Options", "nosniff");
  context.header("Referrer-Policy", "strict-origin-when-cross-origin");
  context.header(
    "X-Frame-Options",
    context.res.headers.get("X-Frame-Options") || "DENY",
  );
  context.header(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  if (api) context.header("Cache-Control", "private, no-store");
  else
    context.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self'; connect-src 'self'; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    );
});

app.use("/api/*", async (context, next) => {
  if (
    !["GET", "HEAD", "OPTIONS"].includes(context.req.method) &&
    !/^\/api\/connectors\/webhooks\/(?:github|notion)(?:\/[a-f0-9-]{36})?$/.test(
      new URL(context.req.url).pathname,
    )
  ) {
    const origin = context.req.header("Origin");
    const expected = new URL(context.req.url).origin;
    if (origin && origin !== expected && origin !== context.env.APP_ORIGIN)
      throw new ApiError(
        403,
        "ORIGIN_REJECTED",
        "Requests must come from this workspace.",
      );
    if (context.req.header("Sec-Fetch-Site") === "cross-site")
      throw new ApiError(
        403,
        "ORIGIN_REJECTED",
        "Cross-site changes are not allowed.",
      );
    if (Number(context.req.header("Content-Length")) > MAX_REQUEST_BYTES)
      throw new ApiError(413, "REQUEST_TOO_LARGE", "The request is too large.");
  }
  // D1-backed counters remain effective when requests reach different isolates.
  const path = new URL(context.req.url).pathname;
  const window = Math.floor(Date.now() / 60_000);
  const limit = path.startsWith("/api/auth/") ? 30 : 240;
  const rateKey = `${path.startsWith("/api/auth/") ? "auth" : "api"}:${context.req.header("CF-Connecting-IP") || "local"}:${window}`;
  const result = await context.env.DB.prepare(
    "INSERT INTO rate_limits(key,window,count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count",
  )
    .bind(rateKey, window)
    .first<{ count: number }>();
  if (result && result.count > limit) {
    context.header("Retry-After", "60");
    throw new ApiError(
      429,
      "RATE_LIMIT",
      "Too many requests. Try again in a minute.",
    );
  }
  if (Math.random() < 0.01)
    await context.env.DB.prepare("DELETE FROM rate_limits WHERE window < ?")
      .bind(window - 5)
      .run();
  await next();
});

app.get("/api/health", (context) =>
  context.json({
    ok: true,
    service: "work",
    environment: context.env.ENVIRONMENT,
    authenticationConfigured: authConfigured(context.env),
  }),
);
app.get("/api/session", async (context) =>
  context.json(await resolveSession(context.env, context.req.raw)),
);
app.on(["GET", "POST"], "/api/auth/*", async (context) => {
  if (Number(context.req.header("Content-Length")) > 100_000)
    throw new ApiError(
      413,
      "REQUEST_TOO_LARGE",
      "The authentication request is too large.",
    );
  if (context.req.method === "POST") {
    const bytes = await readLimitedBody(context.req.raw.clone(), 100_000);
    if (context.req.header("Content-Type")?.includes("application/json")) {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        throw new ApiError(
          400,
          "INVALID_JSON",
          "The authentication request is not valid JSON.",
        );
      }
      if (payload && typeof payload === "object")
        for (const field of [
          "callbackURL",
          "errorCallbackURL",
          "newUserCallbackURL",
          "redirectTo",
          "redirectURI",
        ]) {
          const target = payload[field];
          if (target === undefined) continue;
          let valid = false;
          if (typeof target === "string")
            try {
              valid =
                new URL(target, context.env.APP_ORIGIN).origin ===
                new URL(context.env.APP_ORIGIN).origin;
            } catch {
              /* invalid URL */
            }
          if (!valid)
            throw new ApiError(
              403,
              "CALLBACK_REJECTED",
              "Authentication callbacks must return to this workspace.",
            );
        }
    }
  }
  return createAuth(context.env).handler(context.req.raw);
});

// Retired collections are no longer refreshed by provider deliveries.
app.all("/api/connectors/webhooks/*", (context) =>
  context.json(
    {
      error: {
        code: "RETIRED",
        message: "Connector webhooks have been retired.",
      },
    },
    410,
  ),
);

// Every route below resolves identity from the request; clients never supply owner IDs.
app.use("/api/*", async (context, next) => {
  const path = new URL(context.req.url).pathname;
  const known =
    /^\/api\/(goals(?:\/legacy|\/[^/]+(?:\/checkpoint)?)?|learning(?:\/.*)?|latex\/[^/]+(?:\/(?:revisions(?:\/[^/]+)?|fork|compile|jobs\/[^/]+|submissions))?|connectors(?:\/.*)?|records(?:\/batch|\/[^/]+(?:\/(?:restore|permanent|revisions|related|attachments))?)?|search|preferences|attachments\/[^/]+|backup(?:\/restores(?:\/[^/]+(?:\/commit|\/files\/[^/]+)?)?)?|export|restore|import(?:\/[^/]+\/undo)?|account\/delete)$/.test(
      path,
    );
  if (!known)
    throw new ApiError(404, "NOT_FOUND", "This API endpoint does not exist.");
  const session = await resolveSession(context.env, context.req.raw);
  if (!session.user)
    throw new ApiError(
      401,
      "UNAUTHENTICATED",
      "Sign in to access your private workspace.",
    );
  context.set("user", session.user);
  context.set("local", session.local);
  await next();
});

app.all("/api/connectors/*", (context) =>
  context.json(
    {
      error: {
        code: "RETIRED",
        message:
          "Connections have been retired. Existing imported records remain in your workspace and backups.",
      },
    },
    410,
  ),
);
app.all("/api/connectors", (context) =>
  context.json(
    { error: { code: "RETIRED", message: "Connections have been retired." } },
    410,
  ),
);
app.route("/api/goals/legacy", goalMigrationRoutes);
app.route("/api/goals", goalRoutes);
app.route("/api/learning", learningRoutes);
app.route("/api/latex", latexRoutes);

function assertBehaviouralProtected(record: Pick<WorkRecord, "kind" | "data">) {
  if (
    record.kind === "note" &&
    record.data.category === "interview-tab" &&
    record.data.tabKey === "behavioural"
  )
    throw new ApiError(
      400,
      "PROTECTED_TAB",
      "The Behavioural tab contains your STAR story bank and cannot be removed.",
    );
}
function assertCurrentProductInput(record: {
  kind: string;
  data?: Record<string, unknown>;
}) {
  const data = record.data || {};
  if (
    record.kind === "interview" &&
    (data.appointmentVersion !== 2 || !data.applicationId || !data.stepId)
  )
    throw new ApiError(
      400,
      "STEP_REQUIRED",
      "Add a recruitment step to the application before scheduling.",
    );
  if (
    record.kind === "note" &&
    data.category === "interview-tab" &&
    data.tabKey === "behavioural" &&
    data.hidden
  )
    throw new ApiError(
      400,
      "PROTECTED_TAB",
      "The Behavioural tab cannot be hidden.",
    );
}
app.post("/api/records/reorder", async (context) => {
  const { items, key } = parse(
    z
      .object({
        items: z
          .array(
            z.object({
              id: z.string().min(1),
              version: z.number().int().positive(),
              order: z.number().int().min(0).max(1000000),
            }),
          )
          .min(1)
          .max(200),
        key: z.enum(["order", "directionOrder"]).default("order"),
      })
      .strict(),
    await readJson(context.req.raw),
  );
  if (new Set(items.map((item) => item.id)).size !== items.length)
    throw new ApiError(400, "DUPLICATE_RECORD", "Each item must appear once.");
  const owner = context.get("user").id;
  const records = await Promise.all(
    items.map(async (item) => {
      const before = await getRecord(context.env.DB, owner, item.id);
      if (before.version !== item.version)
        throw new ApiError(
          409,
          "VERSION_CONFLICT",
          "Content changed while arranging it. Refresh and try again.",
        );
      return {
        ...before,
        data: { ...before.data, [key]: item.order },
        version: before.version + 1,
        updatedAt: now(),
      };
    }),
  );
  const guard = crypto.randomUUID();
  try {
    await context.env.DB.batch([
      context.env.DB.prepare(
        "INSERT INTO write_guards(id,value) SELECT ?, count(*)=? FROM records r JOIN json_each(?) j ON r.id=json_extract(j.value,'$.id') AND r.version=json_extract(j.value,'$.version') WHERE r.owner_id=? AND r.deleted_at IS NULL",
      ).bind(guard, items.length, JSON.stringify(items), owner),
      ...records.map((record, i) =>
        updateRecord(context.env.DB, owner, record, items[i].version),
      ),
      context.env.DB.prepare("DELETE FROM write_guards WHERE id=?").bind(guard),
    ]);
  } catch {
    throw new ApiError(
      409,
      "VERSION_CONFLICT",
      "Content changed while arranging it. Nothing was rearranged.",
    );
  }
  return context.json({ records });
});

app.get("/api/records", async (context) => {
  const includeDeleted = context.req.query("includeDeleted") === "true";
  const kind = context.req.query("kind");
  const rows = await context.env.DB.prepare(
    `SELECT * FROM records WHERE owner_id=? AND COALESCE(json_extract(data,'$.connectorSource.available'),1)!=0 ${includeDeleted ? "" : "AND deleted_at IS NULL"} ${kind ? "AND kind=?" : ""} ORDER BY updated_at DESC`,
  )
    .bind(context.get("user").id, ...(kind ? [kind] : []))
    .all<RecordRow>();
  return context.json({ records: rows.results.map(fromRow) });
});

app.post("/api/records/batch", async (context) => {
  const payload = parse(
    z
      .object({
        records: z.array(recordSchema).min(1).max(400),
        idempotencyKey: idempotencyKeySchema.optional(),
      })
      .strict(),
    await readJson(context.req.raw),
  );
  const owner = context.get("user").id;
  const state = await checkIdempotency(
    context.env.DB,
    owner,
    payload.idempotencyKey || context.req.header("Idempotency-Key"),
    payload.records,
  );
  if (state.response) return context.json(state.response);
  const records = payload.records.map((input) => newRecord(input));
  for (const record of records) assertCurrentProductInput(record);
  for (const input of payload.records) assertNativeInput(input.data);
  for (const record of records)
    await validateRecordContract(context.env.DB, owner, record, records);
  const allLinks = [...new Set(records.flatMap((record) => record.links))];
  await validateLinks(context.env.DB, owner, allLinks);
  await validateDataReferences(context.env.DB, owner, {
    batch: records.map((record) => record.data),
  });
  const response = { records };
  try {
    await context.env.DB.batch([
      ...bulkInsertRecords(context.env.DB, owner, records),
      ...referencePresenceStatements(
        context.env.DB,
        owner,
        { batch: records.map((record) => record.data) },
        { links: allLinks },
      ),
      ...bulkInsertLinks(context.env.DB, owner, records),
      ...applicationFileStatements(context.env.DB, owner, records),
      ...recordContractStatements(context.env.DB, owner, records),
      ...idempotencyStatement(context.env.DB, owner, state, response),
    ]);
  } catch (error) {
    const raced = await raceResponse(context.env.DB, owner, state);
    if (raced) return context.json(raced);
    if (String(error).includes("CHECK constraint failed"))
      throw new ApiError(
        409,
        "REFERENCE_CONFLICT",
        "A related record or file changed during this save. Nothing was saved; reload and try again.",
      );
    throw error;
  }
  return context.json(response, 201);
});

app.post("/api/records", async (context) => {
  const input = parse(recordSchema, await readJson(context.req.raw));
  assertCurrentProductInput(input);
  assertNativeInput(input.data);
  const owner = context.get("user").id;
  const state = await checkIdempotency(
    context.env.DB,
    owner,
    context.req.header("Idempotency-Key"),
    input,
  );
  if (state.response) return context.json(state.response);
  const record = newRecord(input);
  await validateRecordContract(context.env.DB, owner, record);
  await validateLinks(context.env.DB, owner, record.links);
  await validateDataReferences(context.env.DB, owner, record.data);
  const response = { record };
  try {
    await context.env.DB.batch([
      insertRecord(context.env.DB, owner, record),
      ...referencePresenceStatements(context.env.DB, owner, record.data, {
        links: record.links,
      }),
      ...insertLinks(context.env.DB, owner, record),
      ...applicationFileStatements(context.env.DB, owner, [record]),
      ...recordContractStatements(context.env.DB, owner, [record]),
      ...idempotencyStatement(context.env.DB, owner, state, response),
    ]);
  } catch (error) {
    const raced = await raceResponse(context.env.DB, owner, state);
    if (raced) return context.json(raced);
    if (String(error).includes("CHECK constraint failed"))
      throw new ApiError(
        409,
        "REFERENCE_CONFLICT",
        "A related record or file changed during this save. Nothing was saved; reload and try again.",
      );
    throw error;
  }
  return context.json(response, 201);
});

app.get("/api/records/:id", async (context) =>
  context.json({
    record: await getRecord(
      context.env.DB,
      context.get("user").id,
      context.req.param("id"),
      context.req.query("includeDeleted") === "true",
    ),
  }),
);
app.patch("/api/records/:id", async (context) => {
  const patch = parse(patchSchema, await readJson(context.req.raw));
  const owner = context.get("user").id;
  const state = await checkIdempotency(
    context.env.DB,
    owner,
    context.req.header("Idempotency-Key"),
    { recordId: context.req.param("id"), patch },
  );
  if (state.response) return context.json(state.response);
  const before = await getRecord(
    context.env.DB,
    owner,
    context.req.param("id"),
  );
  if (patch.version !== before.version)
    throw new ApiError(
      409,
      "VERSION_CONFLICT",
      "This record changed in another session. Your draft has been preserved.",
      { record: before },
    );
  const record: WorkRecord = {
    ...before,
    ...patch,
    version: before.version + 1,
    updatedAt: now(),
  };
  if (
    before.kind === "note" &&
    before.data.category === "interview-tab" &&
    before.data.tabKey === "behavioural" &&
    (record.data.category !== "interview-tab" ||
      record.data.tabKey !== "behavioural" ||
      record.data.hidden)
  )
    throw new ApiError(
      400,
      "PROTECTED_TAB",
      "The Behavioural tab cannot be removed or hidden.",
    );
  // Source/build state is owned by the native project API, not stale metadata forms.
  if (before.kind === "asset") {
    for (const key of ["latexProject", "latexJobs", "submissions"]) {
      if (before.data[key] === undefined) delete record.data[key];
      else record.data[key] = before.data[key];
    }
  }
  assertProviderPatch(before, patch);
  // A recorded stage move is historical evidence, not just the current label.
  if (
    record.kind === "application" &&
    typeof record.data.stage === "string" &&
    before.data.stage !== record.data.stage
  ) {
    const history = Array.isArray(before.data.history)
      ? before.data.history.slice(-99)
      : [];
    record.data = {
      ...record.data,
      history: [
        ...history,
        {
          previous: before.data.stage || "Saved",
          stage: record.data.stage,
          at: record.updatedAt,
        },
      ],
    };
  }
  if(record.kind==='application'&&['applicationStatus','selectedStepId','terminalOutcome'].some(key=>record.data[key]!==before.data[key])){
    record.data={...record.data,stageHistory:[...(Array.isArray(before.data.stageHistory)?before.data.stageHistory:[]).slice(-99),{from:applicationStatusLabel(before),to:applicationStatusLabel(record),at:record.updatedAt,fromStepId:before.data.selectedStepId||'',toStepId:record.data.selectedStepId||''}]};
  }
  const response = { record };
  try {
    await writeRecord(
      context.env.DB,
      owner,
      record,
      before.version,
      idempotencyStatement(context.env.DB, owner, state, response),
    );
  } catch (error) {
    const raced = await raceResponse(context.env.DB, owner, state);
    if (raced) return context.json(raced);
    throw error;
  }
  return context.json(response);
});

app.delete("/api/records/:id", async (context) => {
  const owner = context.get("user").id;
  const before = await getRecord(
    context.env.DB,
    owner,
    context.req.param("id"),
    true,
  );
  if (before.deletedAt) return context.json({ record: before });
  assertBehaviouralProtected(before);
  await assertRecordFilesNotSubmitted(context.env.DB, owner, before.id);
  const record = {
    ...before,
    deletedAt: now(),
    updatedAt: now(),
    version: before.version + 1,
  };
  // Deleting a parent never deletes another record; attachments remain recoverable.
  const detachLiveDocumentLinks =
    before.kind === "application"
      ? [
          context.env.DB.prepare(
            "UPDATE records SET data=json_set(data,'$.applicationIds',json((SELECT json_group_array(value) FROM json_each(records.data,'$.applicationIds') WHERE value!=?))),version=version+1,updated_at=? WHERE owner_id=? AND kind='asset' AND EXISTS(SELECT 1 FROM json_each(records.data,'$.applicationIds') WHERE value=?)",
          ).bind(before.id, now(), owner, before.id),
        ]
      : [];
  await writeRecord(
    context.env.DB,
    owner,
    record,
    before.version,
    detachLiveDocumentLinks,
  );
  return context.json({ record });
});
app.post("/api/records/:id/restore", async (context) => {
  const owner = context.get("user").id;
  const before = await getRecord(
    context.env.DB,
    owner,
    context.req.param("id"),
    true,
  );
  if (!before.deletedAt) return context.json({ record: before });
  const record = {
    ...before,
    deletedAt: null,
    updatedAt: now(),
    version: before.version + 1,
  };
  await writeRecord(context.env.DB, owner, record, before.version);
  return context.json({ record });
});
app.delete("/api/records/:id/permanent", async (context) => {
  const owner = context.get("user").id;
  const recordId = context.req.param("id");
  const record = await getRecord(context.env.DB, owner, recordId, true);
  assertBehaviouralProtected(record);
  if (!record.deletedAt)
    throw new ApiError(
      409,
      "TRASH_FIRST",
      "Move the record to trash before deleting it permanently.",
    );
  await assertRecordFilesNotSubmitted(context.env.DB, owner, recordId, true);
  const files = await context.env.DB.prepare(
    "SELECT id,object_key FROM attachments WHERE owner_id=? AND record_id=?",
  )
    .bind(owner, recordId)
    .all<{ id: string; object_key: string }>();
  const detaches = await detachReferenceStatements(
    context.env.DB,
    owner,
    [recordId],
    files.results.map((file) => file.id),
    recordId,
  );
  try {
    await context.env.DB.batch([
      ...detaches,
      context.env.DB.prepare(
        "DELETE FROM records WHERE id=? AND owner_id=? AND deleted_at IS NOT NULL AND version=?",
      ).bind(recordId, owner, record.version),
      ...assertChanged(context.env.DB),
    ]);
  } catch (error) {
    if (String(error).includes("CHECK constraint failed"))
      throw new ApiError(
        409,
        "VERSION_CONFLICT",
        "This record or a related record changed while deletion was running. Nothing was permanently deleted. Try again with the latest versions.",
      );
    if (String(error).includes("FOREIGN KEY constraint failed"))
      throw new ApiError(
        409,
        "FILE_IN_USE",
        "A document from this record was captured in an application. Remove that captured version before deleting the record permanently.",
      );
    throw error;
  }
  if (files.results.length)
    await context.env.FILES.delete(
      files.results.map((file) => file.object_key),
    );
  return context.json({ deleted: true });
});

app.get("/api/records/:id/revisions", async (context) => {
  const owner = context.get("user").id;
  await getRecord(context.env.DB, owner, context.req.param("id"), true);
  const rows = await context.env.DB.prepare(
    "SELECT * FROM record_revisions WHERE owner_id=? AND record_id=? ORDER BY version DESC LIMIT 100",
  )
    .bind(owner, context.req.param("id"))
    .all<{
      id: string;
      record_id: string;
      version: number;
      title: string;
      body: string;
      tags: string;
      links: string;
      data: string;
      created_at: string;
    }>();
  const revisions: RecordRevision[] = rows.results.map((row) => ({
    id: row.id,
    recordId: row.record_id,
    version: row.version,
    title: row.title,
    body: row.body,
    tags: JSON.parse(row.tags),
    links: JSON.parse(row.links),
    data: JSON.parse(row.data),
    createdAt: row.created_at,
  }));
  return context.json({ revisions });
});

app.get("/api/search", async (context) => {
  const query = context.req.query("q")?.slice(0, 250) || "";
  const expression = searchExpression(query);
  if (!expression) return context.json({ records: [] });
  const rows = await context.env.DB.prepare(
    "SELECT r.* FROM records_fts JOIN records r ON r.id=records_fts.id WHERE records_fts MATCH ? AND r.owner_id=? AND records_fts.owner_id=? AND r.deleted_at IS NULL AND COALESCE(json_extract(r.data,'$.connectorSource.available'),1)!=0 ORDER BY bm25(records_fts),r.updated_at DESC LIMIT 60",
  )
    .bind(expression, context.get("user").id, context.get("user").id)
    .all<RecordRow>();
  return context.json({ records: rows.results.map(fromRow) });
});
app.get("/api/records/:id/related", async (context) => {
  const owner = context.get("user").id;
  await getRecord(context.env.DB, owner, context.req.param("id"));
  const rows = await context.env.DB.prepare(
    "SELECT DISTINCT r.* FROM records r JOIN record_links l ON (r.id=l.target_id OR r.id=l.source_id) AND r.owner_id=l.owner_id WHERE l.owner_id=? AND (l.source_id=? OR l.target_id=?) AND r.id!=? AND r.deleted_at IS NULL AND COALESCE(json_extract(r.data,'$.connectorSource.available'),1)!=0",
  )
    .bind(
      owner,
      context.req.param("id"),
      context.req.param("id"),
      context.req.param("id"),
    )
    .all<RecordRow>();
  return context.json({ records: rows.results.map(fromRow) });
});

app.get("/api/preferences", async (context) => {
  const row = await context.env.DB.prepare(
    "SELECT data FROM preferences WHERE owner_id=?",
  )
    .bind(context.get("user").id)
    .first<{ data: string }>();
  return context.json({
    preferences: {
      ...DEFAULT_PREFERENCES,
      displayName: context.get("user").name,
      ...(row ? JSON.parse(row.data) : {}),
    },
  });
});
app.put("/api/preferences", async (context) => {
  const preferences = parse(preferencesSchema, await readJson(context.req.raw));
  await context.env.DB.prepare(
    "INSERT INTO preferences(owner_id,data,updated_at) VALUES(?,?,?) ON CONFLICT(owner_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at",
  )
    .bind(context.get("user").id, JSON.stringify(preferences), now())
    .run();
  return context.json({ preferences });
});

app.get("/api/records/:id/attachments", async (context) => {
  const owner = context.get("user").id;
  await getRecord(context.env.DB, owner, context.req.param("id"));
  const rows = await context.env.DB.prepare(
    "SELECT * FROM attachments WHERE owner_id=? AND record_id=? ORDER BY created_at",
  )
    .bind(owner, context.req.param("id"))
    .all<AttachmentRow>();
  return context.json({ attachments: rows.results.map(attachmentFromRow) });
});
app.post("/api/records/:id/attachments", async (context) => {
  const owner = context.get("user").id;
  const document = await getRecord(
    context.env.DB,
    owner,
    context.req.param("id"),
  );
  if (
    document.kind === "asset" &&
    ["resume", "letter", "cover-letter"].includes(String(document.data.type))
  )
    throw new ApiError(
      400,
      "NATIVE_DOCUMENT_ONLY",
      "Résumé and cover-letter PDFs are generated from LaTeX. Upload other files under Other documents.",
    );
  const bytes = await readLimitedBody(context.req.raw, MAX_FILE_BYTES + 64_000);
  const form = await new Response(bytes.buffer as ArrayBuffer, {
    headers: { "Content-Type": context.req.header("Content-Type") || "" },
  })
    .formData()
    .catch(() => {
      throw new ApiError(
        400,
        "INVALID_UPLOAD",
        "Send a multipart form containing a file.",
      );
    });
  const file = form.get("file");
  if (!file || typeof file === "string")
    throw new ApiError(400, "FILE_REQUIRED", "Choose a file to attach.");
  const attachment = await saveAttachment(
    context.env,
    owner,
    context.req.param("id"),
    filename(file.name),
    file.type || "application/octet-stream",
    new Uint8Array(await file.arrayBuffer()),
  );
  return context.json({ attachment }, 201);
});
app.get("/api/attachments/:id", async (context) => {
  const row = await getAttachment(
    context.env,
    context.get("user").id,
    context.req.param("id"),
  );
  const object = await context.env.FILES.get(row.object_key);
  if (!object)
    throw new ApiError(
      404,
      "FILE_UNAVAILABLE",
      "The file contents are unavailable. Its metadata is preserved.",
    );
  const inline =
    context.req.query("download") !== "true" &&
    [
      "application/pdf",
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
    ].includes(row.content_type);
  return new Response(object.body, {
    headers: {
      "Content-Type": row.content_type,
      "Content-Length": String(row.size),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename(row.filename).replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        row.content_type === "application/pdf"
          ? "frame-ancestors 'self'"
          : "sandbox; default-src 'none'; frame-ancestors 'self'",
      "X-Frame-Options": "SAMEORIGIN",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
});
app.delete("/api/attachments/:id", async (context) => {
  const owner = context.get("user").id;
  const row = await getAttachment(context.env, owner, context.req.param("id"));
  await assertFilesNotSubmitted(context.env.DB, owner, [row.id]);
  const detaches = await detachReferenceStatements(
    context.env.DB,
    owner,
    [],
    [row.id],
  );
  try {
    await context.env.DB.batch([
      ...detaches,
      context.env.DB.prepare(
        "DELETE FROM attachments WHERE id=? AND owner_id=?",
      ).bind(row.id, owner),
      ...assertChanged(context.env.DB),
    ]);
  } catch (error) {
    if (String(error).includes("CHECK constraint failed"))
      throw new ApiError(
        409,
        "VERSION_CONFLICT",
        "A related record changed while deletion was running. The file was not deleted. Try again with the latest versions.",
      );
    if (String(error).includes("FOREIGN KEY constraint failed"))
      throw new ApiError(
        409,
        "FILE_IN_USE",
        "This document was captured in an application before deletion finished. Remove that captured version first.",
      );
    throw error;
  }
  await context.env.FILES.delete(row.object_key);
  return context.json({ deleted: true });
});

app.get("/api/backup", async (context) =>
  downloadBackup(context.env, context.get("user").id),
);
app.post("/api/backup/restores", async (context) =>
  context.json(
    await beginBackupRestore(
      context.env,
      context.get("user").id,
      await readJson(context.req.raw),
    ),
    201,
  ),
);
app.put("/api/backup/restores/:restoreId/files/:fileId", async (context) =>
  context.json(
    await stageBackupFile(
      context.env,
      context.get("user").id,
      context.req.param("restoreId"),
      context.req.param("fileId"),
      context.req.raw,
    ),
  ),
);
app.post("/api/backup/restores/:restoreId/commit", async (context) =>
  context.json(
    await commitBackupRestore(
      context.env,
      context.get("user").id,
      context.req.param("restoreId"),
    ),
    201,
  ),
);
app.delete("/api/backup/restores/:restoreId", async (context) =>
  context.json(
    await cancelBackupRestore(
      context.env,
      context.get("user").id,
      context.req.param("restoreId"),
    ),
  ),
);

app.get("/api/export", async (context) => {
  const result = await exportWorkspace(
    context.env,
    context.get("user").id,
    context.req.query("files") !== "false",
  );
  context.header(
    "Content-Disposition",
    `attachment; filename="work-backup-${now().slice(0, 10)}.json"`,
  );
  return context.json(result);
});
app.post("/api/restore", async (context) =>
  context.json(
    await restoreWorkspace(
      context.env,
      context.get("user").id,
      await readJson(context.req.raw),
    ),
    201,
  ),
);
app.post("/api/import", async (context) =>
  context.json(
    await importRecords(
      context.env,
      context.get("user").id,
      await readJson(context.req.raw),
    ),
    201,
  ),
);
app.get("/api/import", async (context) => {
  const batches = await context.env.DB.prepare(
    "SELECT id,source,created_at AS createdAt,undone_at AS undoneAt,created_count AS created,updated_count AS updated,skipped_count AS skipped FROM import_batches WHERE owner_id=? ORDER BY created_at DESC LIMIT 100",
  )
    .bind(context.get("user").id)
    .all();
  return context.json({ batches: batches.results });
});
app.post("/api/import/:id/undo", async (context) =>
  context.json(
    await undoImport(
      context.env,
      context.get("user").id,
      context.req.param("id"),
    ),
  ),
);
app.post("/api/account/delete", async (context) => {
  const input = parse(
    z.object({ confirmation: z.literal("DELETE MY WORKSPACE") }).strict(),
    await readJson(context.req.raw),
  );
  void input;
  const owner = context.get("user").id;
  const files = await context.env.DB.prepare(
    "SELECT object_key FROM attachments WHERE owner_id=?",
  )
    .bind(owner)
    .all<{ object_key: string }>();
  if (files.results.length)
    await context.env.FILES.delete(
      files.results.map((file) => file.object_key),
    );
  await cleanupOwnerBackupStaging(context.env, owner);
  await context.env.DB.prepare("DELETE FROM user WHERE id=?").bind(owner).run();
  return context.json({ deleted: true });
});

app.notFound(async (context) => {
  if (new URL(context.req.url).pathname.startsWith("/api"))
    return context.json(
      {
        error: {
          code: "NOT_FOUND",
          message: "This API endpoint does not exist.",
        },
      },
      404,
    );
  if (context.env.ASSETS) return context.env.ASSETS.fetch(context.req.raw);
  return context.text("Work assets are built with Vite.", 404);
});
app.onError((error, context) => {
  if (error instanceof ProviderFailure) {
    if (error.status === 429)
      context.header("Retry-After", String(error.retryAfterSeconds));
    return context.json(
      { error: { code: "PROVIDER_UNAVAILABLE", message: error.message } },
      error.status as 400,
    );
  }
  if (error instanceof ApiError)
    return context.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      },
      error.status as 400,
    );
  // Do not log private content, request bodies, OAuth codes, or database values.
  console.error(
    JSON.stringify({
      operation: context.req.method,
      path: new URL(context.req.url).pathname.replace(
        /\/[0-9a-f-]{36}/g,
        "/:id",
      ),
      code: "INTERNAL_ERROR",
    }),
  );
  return context.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message:
          "The workspace could not complete this request. Your local draft is safe; please retry.",
      },
    },
    500,
  );
});

export { app };
export default {
  fetch: app.fetch,
};
