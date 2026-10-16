import { Hono } from "hono";
import { z } from "zod";
import {
  radarConfigSchema,
  jobSchema,
  nextRadarDate,
  profileMatches,
  canonicalListingUrl,
  type RadarSettings,
} from "../shared/radar";
import { ApiError, id, now, type Env, type Variables } from "./env";
import { hashValue, parse, readJson, recordSchema } from "./validation";
import { getRecord, newRecord, writeRecord } from "./db/records";
import {
  getOpportunity,
  ingestJob,
  opportunityFromRow,
  radarConfig,
  type OpportunityRow,
} from "./radar-store";
import { drainRadar, startRadarRun } from "./radar-runner";
import {
  digestCandidates,
  enqueueRadarDigest,
  drainRadarMail,
} from "./radar-mail";
import { authMailConfigured } from "./auth-mail";
import { validateSource } from "./radar-sources";

const routes = new Hono<{ Bindings: Env; Variables: Variables }>();
routes.get("/settings", async (c) => {
  const owner = c.get("user").id,
    settings = await radarConfig(c.env.DB, owner);
  const runs = await c.env.DB.prepare(
    "SELECT * FROM radar_runs WHERE owner_id=? ORDER BY created_at DESC LIMIT 10",
  )
    .bind(owner)
    .all<{
      id: string;
      status: string;
      created_at: string;
      finished_at: string | null;
      found: number;
      scored: number;
      messages: string;
    }>();
  const usage: RadarSettings["usage"] = [];
  for (const [provider, token, limit] of [
    ["jsearch", c.env.JSEARCH_API_KEY, 180],
    ["apify", c.env.APIFY_TOKEN, 4],
    ["jev", c.env.TYPESAFE_API_KEY, 0.5],
  ] as const) {
    if (!token) continue;
    const period = new Date().toISOString().slice(0, 7),
      scope = await hashValue(token);
    const row = await c.env.DB.prepare(
      "SELECT units FROM radar_usage WHERE provider=? AND scope=? AND period=?",
    )
      .bind(provider, scope, period)
      .first<{ units: number }>();
    usage.push({ provider, units: row?.units || 0, limit, period });
  }
  const deliveries = await c.env.DB.prepare(
    "SELECT id,status,created_at FROM radar_deliveries WHERE owner_id=? ORDER BY created_at DESC LIMIT 5",
  )
    .bind(owner)
    .all();
  return c.json({
    ...settings,
    providers: {
      jsearch: !!c.env.JSEARCH_API_KEY,
      apify: !!c.env.APIFY_TOKEN,
      jev: !!c.env.TYPESAFE_API_KEY,
    },
    runs: runs.results.map((r) => ({
      id: r.id,
      status: r.status,
      createdAt: r.created_at,
      finishedAt: r.finished_at,
      found: r.found,
      scored: r.scored,
      messages: JSON.parse(r.messages),
    })),
    usage,
    emailConfigured: authMailConfigured(c.env),
    deliveries: deliveries.results,
  });
});
routes.put("/settings", async (c) => {
  const input = parse(
    z
      .object({
        config: radarConfigSchema,
        version: z.number().int().nonnegative(),
      })
      .strict(),
    await readJson(c.req.raw),
  );
  const owner = c.get("user").id,
    before = await radarConfig(c.env.DB, owner),
    config = input.config;
  if (before.version !== input.version)
    throw new ApiError(
      409,
      "VERSION_CONFLICT",
      "Radar preferences changed elsewhere. Reload before saving.",
    );
  if (config.emailFrequency !== "disabled" && !authMailConfigured(c.env))
    throw new ApiError(
      400,
      "EMAIL_UNAVAILABLE",
      "The private email sender must be configured before enabling digests.",
    );
  for (const source of config.sources) {
    validateSource(source);
    if (source.companyId) {
      const record = await getRecord(c.env.DB, owner, source.companyId);
      if (record.kind !== "company")
        throw new ApiError(
          400,
          "INVALID_REFERENCE",
          "Choose a company in Interested.",
        );
    }
  }
  if (config.resumeId) {
    const record = await getRecord(c.env.DB, owner, config.resumeId);
    if (record.kind !== "asset")
      throw new ApiError(
        400,
        "INVALID_REFERENCE",
        "Choose a resume in Documents.",
      );
  }
  const nextRun = config.enabled
    ? nextRadarDate(
        config.discoveryFrequency,
        config.timezone,
        config.emailTime,
        config.emailWeekday,
        config.emailMonthday,
      )
    : null;
  const nextEmail = config.enabled
    ? nextRadarDate(
        config.emailFrequency,
        config.timezone,
        config.emailTime,
        config.emailWeekday,
        config.emailMonthday,
      )
    : null;
  const emailSince =
    before.emailSince || (config.emailFrequency !== "disabled" ? now() : null);
  const guard = id();
  try {
    await c.env.DB.batch([
      ...[
        ...config.sources
          .filter((s) => s.companyId)
          .map((s) => ({ id: s.companyId, kind: "company" })),
        ...(config.resumeId ? [{ id: config.resumeId, kind: "asset" }] : []),
      ].flatMap((ref) => [
        c.env.DB.prepare(
          "INSERT INTO write_guards(id,value) SELECT ?,EXISTS(SELECT 1 FROM records WHERE owner_id=? AND id=? AND kind=?)",
        ).bind(guard, owner, ref.id, ref.kind),
        c.env.DB.prepare("DELETE FROM write_guards WHERE id=?").bind(guard),
      ]),
      input.version === 0
        ? c.env.DB.prepare(
            "INSERT INTO radar_settings(owner_id,payload,version,next_run_at,next_email_at,email_since,updated_at) VALUES(?,?,1,?,?,?,?)",
          ).bind(
            owner,
            JSON.stringify(config),
            nextRun,
            nextEmail,
            emailSince,
            now(),
          )
        : c.env.DB.prepare(
            "UPDATE radar_settings SET payload=?,version=version+1,next_run_at=?,next_email_at=?,email_since=?,updated_at=? WHERE owner_id=? AND version=?",
          ).bind(
            JSON.stringify(config),
            nextRun,
            nextEmail,
            emailSince,
            now(),
            owner,
            input.version,
          ),
      c.env.DB.prepare(
        "INSERT INTO write_guards(id,value) VALUES(?,changes()=1)",
      ).bind(guard),
      c.env.DB.prepare("DELETE FROM write_guards WHERE id=?").bind(guard),
      c.env.DB.prepare(
        "UPDATE radar_runs SET status='cancelled',finished_at=? WHERE owner_id=? AND status IN ('queued','running')",
      ).bind(now(), owner),
      c.env.DB.prepare(
        "UPDATE radar_opportunities SET assessment=NULL,interest=-1,version=version+1 WHERE owner_id=?",
      ).bind(owner),
      c.env.DB.prepare(
        "UPDATE radar_deliveries SET status='cancelled',payload='' WHERE owner_id=? AND status='queued'",
      ).bind(owner),
      c.env.DB.prepare(
        "DELETE FROM radar_delivery_items WHERE owner_id=? AND delivery_id IN (SELECT id FROM radar_deliveries WHERE owner_id=? AND status='cancelled')",
      ).bind(owner, owner),
    ]);
  } catch {
    throw new ApiError(
      409,
      "VERSION_CONFLICT",
      "Preferences or a linked document changed. Reload and try again.",
    );
  }
  return c.json({ config, version: input.version + 1 });
});
routes.post("/ping", async (c) => {
  const runId = await startRadarRun(c.env, c.get("user").id, true);
  try {
    c.executionCtx.waitUntil(drainRadar(c.env));
  } catch {
    /* Cron resumes durable tasks. */
  }
  return c.json({ runId }, 202);
});
routes.get("/runs/:id", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT id,status,created_at,finished_at,found,scored,messages FROM radar_runs WHERE owner_id=? AND id=?",
  )
    .bind(c.get("user").id, c.req.param("id"))
    .first();
  if (!row) throw new ApiError(404, "NOT_FOUND", "Run not found.");
  return c.json({ run: row });
});
routes.post("/runs/:id/advance", async (c) => {
  const run = await c.env.DB.prepare(
    "SELECT id FROM radar_runs WHERE id=? AND owner_id=? AND status IN ('queued','running')",
  )
    .bind(c.req.param("id"), c.get("user").id)
    .first();
  if (!run) return c.json({ running: false });
  try {
    c.executionCtx.waitUntil(drainRadar(c.env));
  } catch {
    /* Cron resumes this run. */
  }
  return c.json({ running: true }, 202);
});
routes.get("/opportunities", async (c) => {
  const owner = c.get("user").id,
    query = c.req.query(),
    { config } = await radarConfig(c.env.DB, owner);
  const clauses = ["o.owner_id=?"],
    bindings: (string | number)[] = [owner];
  const view = query.view || "radar";
  if (view === "interested") clauses.push("o.saved=1");
  else if (view === "dismissed") clauses.push("o.dismissed=1");
  else if (view === "tracked") clauses.push("o.tracked=1");
  else if (view !== "all")
    clauses.push("o.saved=0 AND o.dismissed=0 AND o.tracked=0");
  if (query.flagged === "true") clauses.push("o.flagged=1");
  if (query.unread === "true") clauses.push("o.seen=0");
  if (query.q) {
    clauses.push(
      "(json_extract(o.payload,'$.title') LIKE ? ESCAPE '\\' OR json_extract(o.payload,'$.company') LIKE ? ESCAPE '\\' OR json_extract(o.payload,'$.description') LIKE ? ESCAPE '\\')",
    );
    const q = `%${query.q.slice(0, 200).replace(/[\\%_]/g, "\\$&")}%`;
    bindings.push(q, q, q);
  }
  for (const field of ["country", "workplace"] as const)
    if (query[field]) {
      clauses.push(`json_extract(o.payload,'$.${field}')=?`);
      bindings.push(query[field]);
    }
  for (const field of ["employmentType", "seniority"] as const)
    if (query[field]) {
      clauses.push(
        `(COALESCE(json_extract(o.payload,'$.${field}'),'')='' OR instr(lower(json_extract(o.payload,'$.${field}')),lower(?))>0)`,
      );
      bindings.push(query[field].slice(0, 200));
    }
  for (const [parameter, field, operator] of [
    ["postedAfter", "json_extract(o.payload,'$.postedAt')", ">="],
    ["discoveredAfter", "o.first_seen_at", ">="],
    ["closingBefore", "json_extract(o.payload,'$.closingDate')", "<="],
  ] as const) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(query[parameter] || "")) {
      clauses.push(
        `(COALESCE(${field},'')='' OR substr(${field},1,10)${operator}?)`,
      );
      bindings.push(query[parameter]);
    }
  }
  for (const [parameter, bound, operator] of [
    ["minSalary", "max", ">="],
    ["maxSalary", "min", "<="],
  ] as const) {
    const value = Number(query[parameter]);
    if (query[parameter] && Number.isFinite(value) && value >= 0) {
      clauses.push(
        `(json_extract(o.payload,'$.salary') IS NULL OR COALESCE(json_extract(o.payload,'$.salary.estimated'),0)=1 OR COALESCE(json_extract(o.payload,'$.salary.currency'),'')!=? OR COALESCE(json_extract(o.payload,'$.salary.period'),'')!=? OR json_extract(o.payload,'$.salary.${bound}') IS NULL OR json_extract(o.payload,'$.salary.${bound}')${operator}?)`,
      );
      bindings.push(query.currency || "AUD", query.period || "year", value);
    }
  }
  if (query.source) {
    clauses.push(
      "EXISTS(SELECT 1 FROM json_each(o.payload,'$.sources') WHERE lower(json_extract(value,'$.publisher'))=lower(?) OR json_extract(value,'$.provider')=?)",
    );
    bindings.push(query.source, query.source);
  }
  if (query.profile) {
    clauses.push(
      "EXISTS(SELECT 1 FROM json_each(o.profile_ids) WHERE value=?)",
    );
    bindings.push(query.profile);
  }
  if (query.scored === "yes") clauses.push("o.assessment IS NOT NULL");
  if (query.scored === "no") clauses.push("o.assessment IS NULL");
  if (query.salary === "unknown")
    clauses.push("json_extract(o.payload,'$.salary') IS NULL");
  if (query.salary === "listed")
    clauses.push("json_extract(o.payload,'$.salary') IS NOT NULL");
  if (query.qualification === "unknown")
    clauses.push("json_extract(o.assessment,'$.qualification') IS NULL");
  if (query.minInterest && Number.isFinite(Number(query.minInterest))) {
    clauses.push("(o.interest>=? OR o.assessment IS NULL)");
    bindings.push(Math.max(0, Math.min(100, Number(query.minInterest))));
  }
  if (query.confidence) {
    clauses.push(
      "(json_extract(o.assessment,'$.confidence')>=? OR o.assessment IS NULL)",
    );
    bindings.push(Math.max(0, Math.min(1, Number(query.confidence) || 0)));
  }
  const sorts: Record<string, string> = {
    interest: "o.interest DESC,o.first_seen_at DESC",
    qualification:
      "COALESCE(json_extract(o.assessment,'$.qualification'),-1) DESC,o.first_seen_at DESC",
    confidence:
      "COALESCE(json_extract(o.assessment,'$.confidence'),-1) DESC,o.first_seen_at DESC",
    newest: "o.first_seen_at DESC",
    posted: "json_extract(o.payload,'$.postedAt') DESC",
    closing:
      "CASE WHEN json_extract(o.payload,'$.closingDate')='' THEN 1 ELSE 0 END,json_extract(o.payload,'$.closingDate') ASC",
    company: "json_extract(o.payload,'$.company') COLLATE NOCASE ASC",
    role: "json_extract(o.payload,'$.title') COLLATE NOCASE ASC",
    salary:
      "CASE WHEN json_extract(o.payload,'$.salary.currency')=? AND json_extract(o.payload,'$.salary.period')=? THEN COALESCE(json_extract(o.payload,'$.salary.max'),json_extract(o.payload,'$.salary.min'),-1) ELSE -1 END DESC",
  };
  const sort = sorts[query.sort] || sorts.interest;
  const offset = Math.max(0, Math.min(100000, Number(query.cursor) || 0));
  const orderBindings =
    query.sort === "salary"
      ? [query.currency || "AUD", query.period || "year"]
      : [];
  const rows = await c.env.DB.prepare(
    `SELECT o.*,l.application_id FROM radar_opportunities o LEFT JOIN radar_application_links l ON l.owner_id=o.owner_id AND l.opportunity_id=o.id WHERE ${clauses.join(" AND ")} ORDER BY ${sort},o.id LIMIT 100 OFFSET ?`,
  )
    .bind(...bindings, ...orderBindings, offset)
    .all<OpportunityRow>();
  const jobs = rows.results
    .map(opportunityFromRow)
    .filter(
      (job) =>
        view !== "radar" ||
        config.profiles.some((p) =>
          profileMatches(
            query.closed === "true" ? { ...job, closed: false } : job,
            p,
          ),
        ),
    );
  const filtered = jobs
    .filter(
      (job) =>
        !query.location ||
        job.locations.some((l) =>
          l.toLowerCase().includes(query.location.toLowerCase()),
        ),
    )
    .filter((job) => query.closed === "true" || !job.closed)
    .filter(
      (job) =>
        !query.qualification ||
        query.qualification === "unknown" ||
        job.assessment?.qualification == null ||
        job.assessment.qualification >= Number(query.qualification),
    )
    .filter(
      (job) =>
        !query.currency ||
        !job.salary ||
        job.salary.currency === query.currency ||
        !job.salary.currency,
    );
  const nextCursor = rows.results.length === 100 ? String(offset + 100) : null;
  return c.json({ opportunities: filtered, nextCursor });
});
routes.post("/opportunities", async (c) => {
  const job = parse(jobSchema, await readJson(c.req.raw)),
    owner = c.get("user").id;
  if (job.companyId) {
    const company = await getRecord(c.env.DB, owner, job.companyId);
    if (company.kind !== "company")
      throw new ApiError(
        400,
        "INVALID_REFERENCE",
        "Choose a company in Interested.",
      );
  }
  const { config } = await radarConfig(c.env.DB, owner);
  const result = await ingestJob(
    c.env.DB,
    owner,
    job,
    config.profiles.filter((p) => profileMatches(job, p)).map((p) => p.id),
  );
  await c.env.DB.prepare(
    "UPDATE radar_opportunities SET saved=1,version=version+1 WHERE id=? AND owner_id=?",
  )
    .bind(result.id, owner)
    .run();
  return c.json(
    { opportunity: await getOpportunity(c.env.DB, owner, result.id) },
    201,
  );
});
routes.get("/opportunities/:id", async (c) =>
  c.json({
    opportunity: await getOpportunity(
      c.env.DB,
      c.get("user").id,
      c.req.param("id"),
    ),
  }),
);
routes.patch("/opportunities/:id/state", async (c) => {
  const patch = parse(
    z
      .object({
        version: z.number().int().positive(),
        saved: z.boolean().optional(),
        flagged: z.boolean().optional(),
        dismissed: z.boolean().optional(),
        seen: z.boolean().optional(),
        restore: z.boolean().optional(),
        notes: z.string().max(10000).optional(),
      })
      .strict(),
    await readJson(c.req.raw),
  );
  const owner = c.get("user").id,
    job = await getOpportunity(c.env.DB, owner, c.req.param("id"));
  if (patch.restore && job.applicationId)
    throw new ApiError(
      409,
      "ALREADY_TRACKED",
      "This job is still linked to an application.",
    );
  const result = await c.env.DB.prepare(
    "UPDATE radar_opportunities SET saved=?,flagged=?,dismissed=?,seen=?,tracked=?,notes=?,version=version+1 WHERE owner_id=? AND id=? AND version=? RETURNING id",
  )
    .bind(
      +(patch.saved ?? job.saved),
      +(patch.flagged ?? job.flagged),
      +(patch.dismissed ?? job.dismissed),
      +(patch.seen ?? job.seen),
      patch.restore ? 0 : +job.tracked,
      patch.notes ?? job.notes,
      owner,
      job.id,
      patch.version,
    )
    .first();
  if (!result)
    throw new ApiError(
      409,
      "VERSION_CONFLICT",
      "This opportunity changed. Refresh and try again.",
    );
  return c.json({ opportunity: await getOpportunity(c.env.DB, owner, job.id) });
});
routes.post("/opportunities/:id/application", async (c) => {
  const owner = c.get("user").id,
    job = await getOpportunity(c.env.DB, owner, c.req.param("id"));
  if (job.applicationId)
    return c.json({
      record: await getRecord(c.env.DB, owner, job.applicationId),
    });
  const input = parse(recordSchema, await readJson(c.req.raw));
  if (input.kind !== "application")
    throw new ApiError(
      400,
      "INVALID_RECORD",
      "Create an application for this opportunity.",
    );
  const record = newRecord(input);
  try {
    await writeRecord(c.env.DB, owner, record, undefined, [
      c.env.DB.prepare(
        "INSERT INTO radar_application_links(owner_id,opportunity_id,application_id) VALUES(?,?,?)",
      ).bind(owner, job.id, record.id),
    ]);
  } catch (error) {
    const current = await getOpportunity(c.env.DB, owner, job.id);
    if (current.applicationId)
      return c.json({
        record: await getRecord(c.env.DB, owner, current.applicationId),
      });
    throw error;
  }
  return c.json({ record }, 201);
});
routes.post("/opportunities/:id/merge", async (c) => {
  const input = parse(
    z
      .object({
        targetId: z.string().min(1).max(120),
        version: z.number().int().positive(),
        targetVersion: z.number().int().positive(),
      })
      .strict(),
    await readJson(c.req.raw),
  );
  const owner = c.get("user").id,
    from = await getOpportunity(c.env.DB, owner, c.req.param("id")),
    target = await getOpportunity(c.env.DB, owner, input.targetId);
  if (from.id === target.id)
    throw new ApiError(400, "INVALID_MERGE", "Choose another opportunity.");
  if (
    from.requisitionNamespace &&
    from.requisitionNamespace === target.requisitionNamespace &&
    from.requisitionId &&
    target.requisitionId &&
    from.requisitionId !== target.requisitionId
  )
    throw new ApiError(
      409,
      "DIFFERENT_REQUISITIONS",
      "These have different employer requisition IDs. Keep them separate.",
    );
  if (
    from.applicationId &&
    target.applicationId &&
    from.applicationId !== target.applicationId
  )
    throw new ApiError(
      409,
      "TRACKED_MERGE",
      "Both jobs have separate applications. Review their tracking before merging.",
    );
  const sources = [
    ...target.sources,
    ...from.sources.filter(
      (s) =>
        !target.sources.some(
          (t) => canonicalListingUrl(t.url) === canonicalListingUrl(s.url),
        ),
    ),
  ].slice(0, 30);
  const payload = jobSchema.parse(
    Object.fromEntries(
      Object.keys(jobSchema.shape).map((key) => [
        key,
        key === "sources"
          ? sources
          : key === "description" &&
              from.description.length > target.description.length
            ? from.description
            : target[key as keyof typeof target],
      ]),
    ),
  );
  const guard = id(),
    db = c.env.DB;
  try {
    await db.batch([
      db
        .prepare(
          "INSERT INTO write_guards(id,value) SELECT ?,EXISTS(SELECT 1 FROM radar_opportunities WHERE owner_id=? AND id=? AND version=?) AND EXISTS(SELECT 1 FROM radar_opportunities WHERE owner_id=? AND id=? AND version=?)",
        )
        .bind(
          guard,
          owner,
          from.id,
          input.version,
          owner,
          target.id,
          input.targetVersion,
        ),
      db.prepare("DELETE FROM write_guards WHERE id=?").bind(guard),
      db
        .prepare(
          "UPDATE radar_opportunities SET payload=?,saved=?,flagged=?,dismissed=?,tracked=?,notified=?,notes=?,assessment=NULL,interest=-1,version=version+1 WHERE owner_id=? AND id=?",
        )
        .bind(
          JSON.stringify(payload),
          +(from.saved || target.saved),
          +(from.flagged || target.flagged),
          +(from.dismissed || target.dismissed),
          +(from.tracked || target.tracked),
          +(from.notified || target.notified),
          [target.notes, from.notes]
            .filter(Boolean)
            .join("\n\n")
            .slice(0, 10000),
          owner,
          target.id,
        ),
      db
        .prepare(
          "UPDATE radar_identities SET opportunity_id=? WHERE owner_id=? AND opportunity_id=?",
        )
        .bind(target.id, owner, from.id),
      db
        .prepare(
          "UPDATE radar_deliveries SET status='cancelled',payload='' WHERE owner_id=? AND status='queued' AND id IN (SELECT delivery_id FROM radar_delivery_items WHERE owner_id=? AND opportunity_id IN (?,?))",
        )
        .bind(owner, owner, from.id, target.id),
      db
        .prepare(
          "DELETE FROM radar_delivery_items WHERE owner_id=? AND delivery_id IN (SELECT id FROM radar_deliveries WHERE owner_id=? AND status='cancelled')",
        )
        .bind(owner, owner),
      ...(from.applicationId && !target.applicationId
        ? [
            db
              .prepare(
                "UPDATE radar_application_links SET opportunity_id=? WHERE owner_id=? AND opportunity_id=?",
              )
              .bind(target.id, owner, from.id),
          ]
        : []),
      db
        .prepare("DELETE FROM radar_opportunities WHERE owner_id=? AND id=?")
        .bind(owner, from.id),
    ]);
  } catch {
    throw new ApiError(
      409,
      "VERSION_CONFLICT",
      "One of these opportunities changed. Refresh before merging.",
    );
  }
  return c.json({ opportunity: await getOpportunity(db, owner, target.id) });
});
routes.post("/digests/preview", async (c) => {
  const owner = c.get("user").id,
    settings = await radarConfig(c.env.DB, owner);
  return c.json({
    opportunities: await digestCandidates(
      c.env,
      owner,
      settings.config,
      settings.emailSince || new Date(0).toISOString(),
    ),
  });
});
routes.post("/digests/send", async (c) => {
  const result = await enqueueRadarDigest(c.env, c.get("user").id, true);
  try {
    c.executionCtx.waitUntil(drainRadarMail(c.env));
  } catch {
    /* Cron resumes delivery. */
  }
  return c.json(result, 202);
});
routes.post("/digests/:id/retry", async (c) => {
  const owner = c.get("user").id;
  const row = await c.env.DB.prepare(
    "UPDATE radar_deliveries SET status='queued',attempts=0,lease_until=0,next_attempt_at=0 WHERE owner_id=? AND id=? AND status IN ('failed','uncertain') AND expires_at>? RETURNING id",
  )
    .bind(owner, c.req.param("id"), Date.now() + 30000)
    .first();
  if (!row)
    throw new ApiError(
      409,
      "DELIVERY_UNAVAILABLE",
      "This delivery cannot be retried. Expired uncertain deliveries are not automatically resent.",
    );
  try {
    c.executionCtx.waitUntil(drainRadarMail(c.env));
  } catch {
    /* Cron resumes the same delivery ID. */
  }
  return c.json({ queued: true }, 202);
});
export const radarRoutes = routes;
