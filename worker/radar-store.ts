import {
  defaultRadarConfig,
  identityKeys,
  canonicalListingUrl,
  listingIdentityKeys,
  semanticJob,
  type Opportunity,
  type RadarConfig,
  type RadarJob,
  type RadarExport,
} from "../shared/radar";
import { ApiError, id, now, type Env } from "./env";
import { hashValue } from "./validation";

export interface OpportunityRow {
  id: string;
  owner_id: string;
  payload: string;
  version: number;
  first_seen_at: string;
  last_seen_at: string;
  saved: number;
  flagged: number;
  dismissed: number;
  seen: number;
  tracked: number;
  notified: number;
  notes: string;
  assessment: string | null;
  profile_ids: string;
  application_id?: string;
}
export function opportunityFromRow(row: OpportunityRow): Opportunity {
  return {
    ...JSON.parse(row.payload),
    id: row.id,
    version: row.version,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    saved: !!row.saved,
    flagged: !!row.flagged,
    dismissed: !!row.dismissed,
    seen: !!row.seen,
    tracked: !!row.tracked,
    notified: !!row.notified,
    notes: row.notes,
    assessment: row.assessment ? JSON.parse(row.assessment) : null,
    profileIds: JSON.parse(row.profile_ids),
    applicationId: row.application_id || "",
  };
}
export async function getOpportunity(
  db: D1Database,
  owner: string,
  opportunityId: string,
) {
  const row = await db
    .prepare(
      "SELECT o.*,l.application_id FROM radar_opportunities o LEFT JOIN radar_application_links l ON l.owner_id=o.owner_id AND l.opportunity_id=o.id WHERE o.owner_id=? AND o.id=?",
    )
    .bind(owner, opportunityId)
    .first<OpportunityRow>();
  if (!row)
    throw new ApiError(404, "NOT_FOUND", "This opportunity was not found.");
  return opportunityFromRow(row);
}
export async function radarConfig(db: D1Database, owner: string) {
  const row = await db
    .prepare("SELECT * FROM radar_settings WHERE owner_id=?")
    .bind(owner)
    .first<{
      payload: string;
      version: number;
      next_run_at: string | null;
      next_email_at: string | null;
      email_since: string | null;
    }>();
  return row
    ? {
        config: JSON.parse(row.payload) as RadarConfig,
        version: row.version,
        nextRunAt: row.next_run_at,
        nextEmailAt: row.next_email_at,
        emailSince: row.email_since,
      }
    : {
        config: defaultRadarConfig(),
        version: 0,
        nextRunAt: null,
        nextEmailAt: null,
        emailSince: null,
      };
}
export async function identityHashes(job: RadarJob) {
  return Promise.all(identityKeys(job).map(hashValue));
}
export async function trackingStatements(
  db: D1Database,
  owner: string,
  application: { id: string; kind: string; data: Record<string, unknown> },
) {
  if (
    application.kind !== "application" ||
    typeof application.data.url !== "string" ||
    !application.data.url
  )
    return [];
  let hashes: string[];
  try {
    hashes = await Promise.all(
      listingIdentityKeys(application.data.url).map(hashValue),
    );
  } catch {
    return [];
  }
  return [
    db
      .prepare(
        "INSERT OR IGNORE INTO radar_application_links(owner_id,opportunity_id,application_id) SELECT ?,opportunity_id,? FROM radar_identities WHERE owner_id=? AND identity IN (SELECT value FROM json_each(?))",
      )
      .bind(owner, application.id, owner, JSON.stringify(hashes)),
  ];
}
export async function ingestJob(
  db: D1Database,
  owner: string,
  job: RadarJob,
  profileIds: string[],
  attempt = 0,
): Promise<{ id: string; created: boolean; changed: boolean }> {
  const hashes = await identityHashes(job);
  if (!hashes.length)
    throw new ApiError(
      400,
      "LISTING_IDENTITY",
      "Use a job-specific listing URL rather than a general careers page.",
    );
  const found = await db
    .prepare(
      "SELECT DISTINCT o.* FROM radar_opportunities o JOIN radar_identities i ON o.id=i.opportunity_id AND o.owner_id=i.owner_id WHERE i.owner_id=? AND i.identity IN (SELECT value FROM json_each(?)) ORDER BY o.first_seen_at,o.id LIMIT 2",
    )
    .bind(owner, JSON.stringify(hashes))
    .all<OpportunityRow>();
  // Conflicting identity edges require review, rather than merging unrelated vacancies transitively.
  const before = found.results[0],
    at = now(),
    opportunityId = before?.id || id();
  let next = job;
  if (before) {
    const old = JSON.parse(before.payload) as RadarJob;
    if (
      old.requisitionId &&
      job.requisitionId &&
      old.requisitionNamespace === job.requisitionNamespace &&
      old.requisitionId !== job.requisitionId
    )
      throw new ApiError(
        409,
        "IDENTITY_CONFLICT",
        "Source identity conflicts with an existing requisition.",
      );
    const sources = [...old.sources];
    for (const source of job.sources) {
      const index = sources.findIndex(
        (s) => canonicalListingUrl(s.url) === canonicalListingUrl(source.url),
      );
      if (index < 0) sources.push(source);
      else sources[index] = source;
    }
    next = {
      ...old,
      ...job,
      sources: sources.slice(0, 30),
      description:
        job.description.length >= old.description.length
          ? job.description
          : old.description,
      salary: job.salary || old.salary,
      companyId: job.companyId || old.companyId,
      companyUrl: job.companyUrl || old.companyUrl,
      locations: [...new Set([...old.locations, ...job.locations])].slice(
        0,
        30,
      ),
    };
  }
  const changed =
    !before ||
    (await hashValue(semanticJob(JSON.parse(before.payload)))) !==
      (await hashValue(semanticJob(next)));
  const guard = id();
  const statements = before
    ? [
        db
          .prepare(
            "UPDATE radar_opportunities SET payload=?,last_seen_at=?,profile_ids=?,version=version+1,assessment=CASE WHEN ? THEN NULL ELSE assessment END,interest=CASE WHEN ? THEN -1 ELSE interest END WHERE id=? AND owner_id=? AND version=?",
          )
          .bind(
            JSON.stringify(next),
            at,
            JSON.stringify(profileIds),
            changed ? 1 : 0,
            changed ? 1 : 0,
            opportunityId,
            owner,
            before.version,
          ),
        db
          .prepare("INSERT INTO write_guards(id,value) VALUES(?,changes()=1)")
          .bind(guard),
        db.prepare("DELETE FROM write_guards WHERE id=?").bind(guard),
      ]
    : [
        db
          .prepare(
            "INSERT INTO radar_opportunities(id,owner_id,payload,first_seen_at,last_seen_at,profile_ids) VALUES(?,?,?,?,?,?)",
          )
          .bind(
            opportunityId,
            owner,
            JSON.stringify(next),
            at,
            at,
            JSON.stringify(profileIds),
          ),
      ];
  for (const hash of hashes)
    statements.push(
      db
        .prepare(
          "INSERT OR IGNORE INTO radar_identities(owner_id,identity,opportunity_id) VALUES(?,?,?)",
        )
        .bind(owner, hash, opportunityId),
    );
  // A competing ingestion may have claimed an alias after our initial read.
  // Roll back this whole write rather than leave an opportunity with no identities.
  statements.push(
    db
      .prepare(
        "INSERT INTO write_guards(id,value) SELECT ?,(SELECT COUNT(*) FROM radar_identities WHERE owner_id=? AND opportunity_id=? AND identity IN (SELECT value FROM json_each(?)))=?",
      )
      .bind(guard, owner, opportunityId, JSON.stringify(hashes), hashes.length),
    db.prepare("DELETE FROM write_guards WHERE id=?").bind(guard),
  );
  // Reconcile manually tracked applications by exact listing URL, across all source aliases.
  const applications = await db
    .prepare(
      "SELECT id,data FROM records WHERE owner_id=? AND kind='application'",
    )
    .bind(owner)
    .all<{ id: string; data: string }>();
  for (const app of applications.results) {
    const data = JSON.parse(app.data);
    if (typeof data.url === "string" && data.url) {
      try {
        if (
          listingIdentityKeys(data.url).some((key) =>
            identityKeys(next).includes(key),
          )
        )
          statements.push(
            db
              .prepare(
                "INSERT OR IGNORE INTO radar_application_links(owner_id,opportunity_id,application_id) VALUES(?,?,?)",
              )
              .bind(owner, opportunityId, app.id),
          );
      } catch {
        /* Legacy URLs cannot invalidate a new discovery. */
      }
    }
  }
  try {
    await db.batch(statements);
  } catch (error) {
    if (/UNIQUE|CHECK constraint/.test(String(error))) {
      if (attempt === 0) return ingestJob(db, owner, job, profileIds, 1);
      throw new ApiError(
        409,
        "RADAR_CONFLICT",
        "This opportunity changed concurrently. Retry this source.",
      );
    }
    throw error;
  }
  return { id: opportunityId, created: !before, changed };
}
export async function exportRadar(
  env: Env,
  owner: string,
): Promise<RadarExport | undefined> {
  const settings = await radarConfig(env.DB, owner);
  const rows = await env.DB.prepare(
    "SELECT o.*,l.application_id FROM radar_opportunities o LEFT JOIN radar_application_links l ON o.id=l.opportunity_id AND o.owner_id=l.owner_id WHERE o.owner_id=? ORDER BY o.first_seen_at,o.id LIMIT 10001",
  )
    .bind(owner)
    .all<OpportunityRow>();
  if (!settings.version && !rows.results.length) return;
  if (rows.results.length > 10000)
    throw new ApiError(
      413,
      "EXPORT_TOO_LARGE",
      "Radar has more than 10,000 opportunities. Archive older discoveries before exporting.",
    );
  return {
    config: settings.config,
    opportunities: rows.results.map(opportunityFromRow),
  };
}
export async function restoreRadarStatements(
  db: D1Database,
  owner: string,
  snapshot?: RadarExport,
): Promise<D1PreparedStatement[]> {
  const statements = [
    "radar_runs",
    "radar_deliveries",
    "radar_opportunities",
    "radar_scores",
    "radar_cursors",
    "radar_settings",
  ].map((table) =>
    db.prepare(`DELETE FROM ${table} WHERE owner_id=?`).bind(owner),
  );
  // Usage is intentionally not restored/reset: imports cannot reset an external provider's allowance.
  if (!snapshot) return statements;
  const config = {
    ...snapshot.config,
    enabled: false,
    emailFrequency: "disabled",
  };
  statements.push(
    db
      .prepare(
        "INSERT INTO radar_settings(owner_id,payload,updated_at) VALUES(?,?,?)",
      )
      .bind(owner, JSON.stringify(config), now()),
  );
  for (const opportunity of snapshot.opportunities) {
    const {
      id: oid,
      version,
      firstSeenAt,
      lastSeenAt,
      saved,
      flagged,
      dismissed,
      seen,
      tracked,
      notified,
      notes,
      applicationId,
      assessment,
      profileIds,
      ...job
    } = opportunity;
    void version;
    void assessment;
    statements.push(
      db
        .prepare(
          "INSERT INTO radar_opportunities(id,owner_id,payload,first_seen_at,last_seen_at,saved,flagged,dismissed,seen,tracked,notified,notes,profile_ids) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          oid,
          owner,
          JSON.stringify(job),
          firstSeenAt,
          lastSeenAt,
          +saved,
          +flagged,
          +dismissed,
          +seen,
          +tracked,
          +notified,
          notes,
          JSON.stringify(profileIds),
        ),
    );
    for (const hash of await identityHashes(job))
      statements.push(
        db
          .prepare(
            "INSERT OR IGNORE INTO radar_identities(owner_id,identity,opportunity_id) VALUES(?,?,?)",
          )
          .bind(owner, hash, oid),
      );
    if (applicationId)
      statements.push(
        db
          .prepare(
            "INSERT INTO radar_application_links(owner_id,opportunity_id,application_id) VALUES(?,?,?)",
          )
          .bind(owner, oid, applicationId),
      );
  }
  return statements;
}
