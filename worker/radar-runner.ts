import {
  nextRadarDate,
  profileMatches,
  type RadarConfig,
  type RadarJob,
  type RadarSource,
} from "../shared/radar";
import { ApiError, id, now, type Env } from "./env";
import { epochDatabase } from "./workspace-epoch";
import { hashValue } from "./validation";
import { getOpportunity, ingestJob, radarConfig } from "./radar-store";
import { assessJob, reserveUsage } from "./radar-jev";
import {
  employerBoard,
  list,
  normalizeApify,
  normalizeBoard,
  normalizeJSearch,
  object,
  providerJson,
  SourceError,
  sourceQuery,
  string,
  validateSource,
} from "./radar-sources";

interface Run {
  id: string;
  owner_id: string;
  epoch: string;
  config_version: number;
  manual: number;
  status: string;
  created_at: string;
}
interface Task {
  id: string;
  run_id: string;
  owner_id: string;
  kind: string;
  payload: string;
  attempts: number;
}
type CollectTask = {
  source: RadarSource;
  profileId?: string;
  location?: string;
  cursor?: string;
  page?: number;
  actorRunId?: string;
  datasetId?: string;
  build?: string;
};
async function addMessage(env: Env, runId: string, message: string) {
  await env.DB.prepare(
    "UPDATE radar_runs SET messages=json_insert(messages,'$[#]',?) WHERE id=? AND json_array_length(messages)<30",
  )
    .bind(message.slice(0, 500), runId)
    .run();
}
export async function startRadarRun(env: Env, owner: string, manual: boolean) {
  const settings = await radarConfig(env.DB, owner);
  if (!settings.version)
    throw new ApiError(
      400,
      "RADAR_SETUP",
      "Save your Radar preferences before running a search.",
    );
  if (!manual && !settings.config.enabled) return null;
  const active = await env.DB.prepare(
    "SELECT id FROM radar_runs WHERE owner_id=? AND status IN ('queued','running')",
  )
    .bind(owner)
    .first<{ id: string }>();
  if (active) return active.id;
  const recent = await env.DB.prepare(
    "SELECT id FROM radar_runs WHERE owner_id=? AND created_at>? ORDER BY created_at DESC LIMIT 1",
  )
    .bind(owner, new Date(Date.now() - 60000).toISOString())
    .first<{ id: string }>();
  if (recent) return recent.id;
  const state = await env.DB.prepare(
    "SELECT epoch FROM workspace_state WHERE owner_id=?",
  )
    .bind(owner)
    .first<{ epoch: string }>();
  if (!state)
    throw new ApiError(409, "WORKSPACE_REPLACED", "Reload your workspace.");
  const runId = id(),
    tasks: CollectTask[] = [];
  const profiles = settings.config.profiles.filter((p) => p.enabled);
  for (const source of settings.config.sources.filter((s) => s.enabled)) {
    validateSource(source);
    if (source.type === "jsearch" || source.type === "apify") {
      for (const p of profiles) {
        if (
          source.type === "apify" &&
          source.actor === "saswave/seek-scraper" &&
          !["au", "nz"].includes(p.country)
        )
          continue;
        const locations = p.locations.length ? p.locations : [""];
        // Rotate broad exploration profiles to keep the default allocation near five requests/day.
        const locationsForRun =
          p.id === "security-au"
            ? [locations[Math.floor(Date.now() / 86400000) % locations.length]]
            : locations.slice(0, 2);
        for (const location of locationsForRun)
          tasks.push({ source, profileId: p.id, location });
      }
    } else tasks.push({ source });
  }
  const cursors = await env.DB.prepare(
    "SELECT source_id,profile_id,location,query_hash,cursor FROM radar_cursors WHERE owner_id=? ORDER BY updated_at ASC LIMIT 50",
  )
    .bind(owner)
    .all<{
      source_id: string;
      profile_id: string;
      location: string;
      query_hash: string;
      cursor: string;
    }>();
  for (const saved of cursors.results) {
    const source = settings.config.sources.find(
        (s) => s.id === saved.source_id && s.enabled && s.type === "jsearch",
      ),
      profile = profiles.find((p) => p.id === saved.profile_id);
    if (
      source &&
      profile &&
      saved.query_hash ===
        (await hashValue([
          sourceQuery(profile, saved.location),
          profile.country,
        ])) &&
      saved.cursor
    ) {
      tasks.push({
        source,
        profileId: profile.id,
        location: saved.location,
        cursor: saved.cursor,
      });
      break;
    }
  }
  if (!tasks.length)
    throw new ApiError(
      400,
      "RADAR_SETUP",
      "Enable a search profile and discovery source first.",
    );
  const db = epochDatabase(env.DB, owner, state.epoch);
  try {
    await db.batch([
      db
        .prepare(
          "INSERT INTO radar_runs(id,owner_id,epoch,config_version,manual,status,created_at) VALUES(?,?,?,?,?,'queued',?)",
        )
        .bind(runId, owner, state.epoch, settings.version, +manual, now()),
      ...tasks
        .slice(0, 30)
        .map((t) =>
          db
            .prepare(
              "INSERT INTO radar_tasks(id,run_id,owner_id,kind,payload) VALUES(?,?,?,'collect',?)",
            )
            .bind(id(), runId, owner, JSON.stringify(t)),
        ),
      db
        .prepare(
          "INSERT OR IGNORE INTO radar_tasks(id,run_id,owner_id,kind,payload) SELECT lower(hex(randomblob(16))),?,?,'score',json_object('opportunityId',id) FROM radar_opportunities WHERE owner_id=? AND saved=0 AND tracked=0 AND dismissed=0 AND assessment IS NULL ORDER BY first_seen_at ASC LIMIT 40",
        )
        .bind(runId, owner, owner),
    ]);
  } catch (error) {
    const race = await env.DB.prepare(
      "SELECT id FROM radar_runs WHERE owner_id=? AND status IN ('queued','running')",
    )
      .bind(owner)
      .first<{ id: string }>();
    if (race) return race.id;
    throw error;
  }
  return runId;
}
async function storeJobs(
  env: Env,
  run: Run,
  config: RadarConfig,
  jobs: (RadarJob | null)[],
) {
  const candidates = jobs.filter(
    (j): j is RadarJob =>
      !!j && config.profiles.some((p) => profileMatches(j, p)),
  );
  for (let start = 0; start < candidates.length; start += 20)
    await env.DB.batch(
      candidates
        .slice(start, start + 20)
        .map((job) =>
          env.DB.prepare(
            "INSERT OR IGNORE INTO radar_tasks(id,run_id,owner_id,kind,payload) VALUES(?,?,?,'ingest',?)",
          ).bind(id(), run.id, run.owner_id, JSON.stringify(job)),
        ),
    );
}
async function ingest(env: Env, run: Run, config: RadarConfig, job: RadarJob) {
  let found = 0;
  {
    const profileIds = config.profiles
      .filter((p) => profileMatches(job, p))
      .map((p) => p.id);
    if (!profileIds.length) return;
    const result = await ingestJob(env.DB, run.owner_id, job, profileIds);
    if (result.created) found++;
    const opportunity = await getOpportunity(env.DB, run.owner_id, result.id);
    if (!opportunity.saved && !opportunity.dismissed && !opportunity.tracked) {
      await env.DB.prepare(
        "INSERT OR IGNORE INTO radar_tasks(id,run_id,owner_id,kind,payload) SELECT ?,?,?,'score',? WHERE (SELECT COUNT(*) FROM radar_tasks WHERE run_id=? AND kind='score')<40",
      )
        .bind(
          id(),
          run.id,
          run.owner_id,
          JSON.stringify({ opportunityId: result.id }),
          run.id,
        )
        .run();
    }
  }
  if (found)
    await env.DB.prepare("UPDATE radar_runs SET found=found+? WHERE id=?")
      .bind(found, run.id)
      .run();
}
async function collect(
  env: Env,
  run: Run,
  task: Task,
  config: RadarConfig,
): Promise<boolean> {
  const t = JSON.parse(task.payload) as CollectTask,
    source = t.source,
    at = now();
  validateSource(source);
  const profile = config.profiles.find((p) => p.id === t.profileId);
  let jobs: (RadarJob | null)[];
  if (source.type === "jsearch") {
    if (!profile || !env.JSEARCH_API_KEY)
      throw new SourceError(
        "UNCONFIGURED",
        "JSearch is not configured or its profile was removed.",
      );
    await reserveUsage(env, "jsearch", env.JSEARCH_API_KEY, 1, 180);
    const endpoint = new URL("https://api.openwebninja.com/jsearch/search-v2");
    endpoint.searchParams.set("query", sourceQuery(profile, t.location || ""));
    endpoint.searchParams.set("country", profile.country);
    endpoint.searchParams.set("language", "en");
    if (t.cursor) endpoint.searchParams.set("cursor", t.cursor);
    const result = object(
      await providerJson(endpoint.toString(), {
        headers: { "x-api-key": env.JSEARCH_API_KEY },
      }),
    );
    if (result.status !== "OK")
      throw new SourceError(
        "FORMAT",
        "JSearch did not return a successful search response.",
      );
    const data = object(result.data),
      rows = Array.isArray(result.data) ? result.data : list(data.jobs);
    jobs = rows.map((v) => normalizeJSearch(v, at));
    const cursor = string(data.cursor);
    if (cursor)
      await env.DB.prepare(
        "INSERT INTO radar_cursors(owner_id,source_id,profile_id,location,query_hash,cursor,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(owner_id,source_id,profile_id,location) DO UPDATE SET cursor=CASE WHEN ? OR radar_cursors.query_hash!=excluded.query_hash THEN excluded.cursor ELSE radar_cursors.cursor END,query_hash=excluded.query_hash,updated_at=excluded.updated_at",
      )
        .bind(
          run.owner_id,
          source.id,
          profile.id,
          t.location || "",
          await hashValue([
            sourceQuery(profile, t.location || ""),
            profile.country,
          ]),
          cursor,
          at,
          t.cursor ? 1 : 0,
        )
        .run();
    else if (t.cursor)
      await env.DB.prepare(
        "DELETE FROM radar_cursors WHERE owner_id=? AND source_id=? AND profile_id=? AND location=?",
      )
        .bind(run.owner_id, source.id, profile.id, t.location || "")
        .run();
    if (cursor && !t.cursor)
      await addMessage(
        env,
        run.id,
        `${profile.name}: a page was collected. Continuation pages rotate across later runs within the free allowance.`,
      );
  } else if (source.type === "apify") {
    if (!env.APIFY_TOKEN || !profile)
      throw new SourceError(
        "UNCONFIGURED",
        "Apify is not configured or its profile was removed.",
      );
    const headers = { Authorization: `Bearer ${env.APIFY_TOKEN}` };
    if (!t.actorRunId) {
      const me = object(
        object(
          await providerJson("https://api.apify.com/v2/users/me", { headers }),
        ).data,
      );
      if (string(object(me.plan).id).toUpperCase() !== "FREE")
        throw new SourceError(
          "PLAN",
          "Apify collection requires a Free plan to prevent paid overages.",
        );
      const actor = object(
        object(
          await providerJson(
            `https://api.apify.com/v2/acts/${source.actor.replace("/", "~")}`,
            { headers },
          ),
        ).data,
      );
      const pricing = list(actor.pricingInfos)
        .map(object)
        .filter((p) => new Date(string(p.startedAt)).getTime() <= Date.now())
        .sort((a, b) =>
          string(b.startedAt).localeCompare(string(a.startedAt)),
        )[0];
      if (!pricing || pricing.pricingModel !== "PAY_PER_EVENT")
        throw new SourceError(
          "PRICING",
          "Collector pricing changed. It is paused pending review.",
        );
      const events = object(object(pricing.pricingPerEvent).actorChargeEvents);
      if (
        Object.values(events).some((e) => {
          const event = object(e),
            tier = object(object(event.eventTieredPricingUsd).FREE);
          const price = Number(event.eventPriceUsd ?? tier.tieredEventPriceUsd);
          return !Number.isFinite(price) || price > 0.01;
        })
      )
        throw new SourceError(
          "PRICING",
          "Collector event price exceeds the reviewed bound.",
        );
      await reserveUsage(env, "apify", env.APIFY_TOKEN, 0.05, 4);
      const query =
        profile.titles[0] || profile.keywords[0] || "software engineer";
      const input = source.actor.startsWith("saswave/")
        ? {
            keywords: query,
            where: t.location,
            domain_country: profile.country.toUpperCase(),
            max_pages: 1,
          }
        : source.actor.startsWith("automation-lab/")
          ? {
              query,
              location: t.location,
              country: profile.country.toUpperCase(),
              maxItems: 10,
              includeDescription: true,
              maxRequestRetries: 1,
            }
          : {
              keywords: query,
              location: t.location,
              maxItems: 10,
              datePosted: "pastWeek",
            };
      const build =
        string(object(object(actor.taggedBuilds).latest).buildNumber) ||
        string(object(actor.defaultRunOptions).build);
      const endpoint = new URL(
        `https://api.apify.com/v2/acts/${source.actor.replace("/", "~")}/runs`,
      );
      endpoint.searchParams.set("maxTotalChargeUsd", "0.05");
      endpoint.searchParams.set("timeout", "120");
      endpoint.searchParams.set("memory", "256");
      if (build) endpoint.searchParams.set("build", build);
      // Persist a start marker BEFORE the non-idempotent external start; lost responses are never blindly retried.
      await env.DB.prepare("UPDATE radar_tasks SET payload=? WHERE id=?")
        .bind(JSON.stringify({ ...t, actorRunId: "starting" }), task.id)
        .run();
      const started = object(
        object(
          await providerJson(endpoint.toString(), {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify(input),
          }),
        ).data,
      );
      if (!string(started.id))
        throw new SourceError("FORMAT", "Collector did not return a run ID.");
      await env.DB.prepare(
        "UPDATE radar_tasks SET payload=?,status='queued',lease_until=? WHERE id=?",
      )
        .bind(
          JSON.stringify({ ...t, actorRunId: string(started.id), build }),
          Date.now() + 15000,
          task.id,
        )
        .run();
      return false;
    }
    if (t.actorRunId === "starting")
      throw new SourceError(
        "UNCERTAIN",
        "Collector start outcome is uncertain. Check Apify before running again.",
      );
    const result = object(
      object(
        await providerJson(
          `https://api.apify.com/v2/actor-runs/${encodeURIComponent(t.actorRunId)}`,
          { headers },
        ),
      ).data,
    );
    if (
      ["READY", "RUNNING", "TIMING-OUT", "ABORTING"].includes(
        string(result.status),
      )
    ) {
      await env.DB.prepare(
        "UPDATE radar_tasks SET status='queued',lease_until=? WHERE id=?",
      )
        .bind(Date.now() + 15000, task.id)
        .run();
      return false;
    }
    if (result.status !== "SUCCEEDED")
      throw new SourceError(
        "COLLECTOR",
        `Collector finished with ${string(result.status) || "unknown status"}.`,
      );
    const dataset = string(result.defaultDatasetId);
    if (!/^[\w-]+$/.test(dataset))
      throw new SourceError("FORMAT", "Collector dataset is unavailable.");
    const rows = await providerJson(
      `https://api.apify.com/v2/datasets/${dataset}/items?clean=true&limit=50`,
      { headers },
    );
    jobs = list(rows).map((v) =>
      normalizeApify(v, source.actor, at, profile.country),
    );
  } else {
    const board = employerBoard(source.url);
    if (!board)
      throw new SourceError(
        "UNSUPPORTED",
        "This careers page does not expose a supported employer feed. Keep its link in Interested.",
      );
    const company = source.companyId
      ? await env.DB.prepare(
          "SELECT title FROM records WHERE owner_id=? AND id=? AND kind='company'",
        )
          .bind(run.owner_id, source.companyId)
          .first<{ title: string }>()
      : null;
    let endpoint = board.endpoint;
    if (board.type === "lever")
      endpoint = endpoint.replace("skip=0", `skip=${(t.page || 0) * 100}`);
    const result = await providerJson(endpoint),
      data = object(result),
      rows = board.type === "lever" ? list(result) : list(data.jobs);
    jobs = rows.map((v) =>
      normalizeBoard(
        board.type,
        board.slug,
        company?.title || source.name,
        source.companyId,
        v,
        at,
      ),
    );
    if (board.type === "lever" && rows.length === 100 && (t.page || 0) < 9)
      await env.DB.prepare(
        "INSERT OR IGNORE INTO radar_tasks(id,run_id,owner_id,kind,payload) VALUES(?,?,?,'collect',?)",
      )
        .bind(
          id(),
          run.id,
          run.owner_id,
          JSON.stringify({ ...t, page: (t.page || 0) + 1 }),
        )
        .run();
  }
  await storeJobs(env, run, config, jobs);
  if (!jobs.length)
    await addMessage(
      env,
      run.id,
      `${source.name}: no listings returned. This does not mark existing jobs closed.`,
    );
  else if (jobs.every((j) => !j))
    await addMessage(
      env,
      run.id,
      `${source.name}: listings could not be parsed; source format may have changed.`,
    );
  return true;
}
async function score(env: Env, run: Run, task: Task, config: RadarConfig) {
  const opportunity = await getOpportunity(
    env.DB,
    run.owner_id,
    JSON.parse(task.payload).opportunityId,
  );
  if (opportunity.saved || opportunity.dismissed || opportunity.tracked) return;
  const results = [];
  for (const p of config.profiles.filter((p) => profileMatches(opportunity, p)))
    results.push(await assessJob(env, run.owner_id, opportunity, p, config));
  results.sort(
    (a, b) =>
      b.interest - a.interest ||
      (config.profiles.find((p) => p.id === b.profileId)?.priority || 0) -
        (config.profiles.find((p) => p.id === a.profileId)?.priority || 0),
  );
  if (results[0]) {
    await env.DB.prepare(
      "UPDATE radar_opportunities SET assessment=?,interest=?,profile_ids=?,version=version+1 WHERE owner_id=? AND id=? AND version=? AND tracked=0 AND saved=0 AND dismissed=0",
    )
      .bind(
        JSON.stringify(results[0]),
        results[0].interest,
        JSON.stringify(results.map((r) => r.profileId)),
        run.owner_id,
        opportunity.id,
        opportunity.version,
      )
      .run();
    await env.DB.prepare("UPDATE radar_runs SET scored=scored+1 WHERE id=?")
      .bind(run.id)
      .run();
  }
}
export async function drainRadar(env: Env, count = 3) {
  // A crashed external call remains uncertain; leases bound concurrent workers, not external billing.
  const tasks = await env.DB.prepare(
    "UPDATE radar_tasks SET status='running',lease_until=?,attempts=attempts+1 WHERE id IN (SELECT t.id FROM radar_tasks t JOIN radar_runs r ON r.id=t.run_id WHERE r.status IN ('queued','running') AND t.status IN ('queued','running') AND t.lease_until<=? AND t.attempts<12 ORDER BY CASE t.kind WHEN 'collect' THEN 0 WHEN 'ingest' THEN 1 ELSE 2 END,t.rowid LIMIT ?) RETURNING *",
  )
    .bind(Date.now() + 90000, Date.now(), count)
    .all<Task>();
  for (const task of tasks.results) {
    const run = await env.DB.prepare("SELECT * FROM radar_runs WHERE id=?")
      .bind(task.run_id)
      .first<Run>();
    if (!run) continue;
    const settings = await radarConfig(env.DB, run.owner_id);
    const state = await env.DB.prepare(
      "SELECT epoch FROM workspace_state WHERE owner_id=?",
    )
      .bind(run.owner_id)
      .first<{ epoch: string }>();
    if (
      state?.epoch !== run.epoch ||
      settings.version !== run.config_version ||
      (!run.manual && !settings.config.enabled)
    ) {
      await env.DB.prepare(
        "UPDATE radar_runs SET status='cancelled',finished_at=? WHERE id=?",
      )
        .bind(now(), run.id)
        .run();
      continue;
    }
    const scoped = {
      ...env,
      DB: epochDatabase(env.DB, run.owner_id, run.epoch, run.config_version),
    };
    await scoped.DB.prepare("UPDATE radar_runs SET status='running' WHERE id=?")
      .bind(run.id)
      .run();
    try {
      const done =
        task.kind === "collect"
          ? await collect(scoped, run, task, settings.config)
          : task.kind === "ingest"
            ? (await ingest(
                scoped,
                run,
                settings.config,
                JSON.parse(task.payload),
              ),
              true)
            : (await score(scoped, run, task, settings.config), true);
      const current = await radarConfig(env.DB, run.owner_id);
      if (current.version !== run.config_version) {
        await env.DB.prepare(
          "UPDATE radar_runs SET status='cancelled',finished_at=? WHERE id=?",
        )
          .bind(now(), run.id)
          .run();
        continue;
      }
      if (done)
        await scoped.DB.prepare(
          "UPDATE radar_tasks SET status='complete',lease_until=0 WHERE id=?",
        )
          .bind(task.id)
          .run();
    } catch (error) {
      await addMessage(
        env,
        run.id,
        error instanceof SourceError || error instanceof ApiError
          ? error.message
          : "A Radar task failed. Its candidates remain available; check source configuration.",
      );
      await env.DB.prepare(
        "UPDATE radar_tasks SET status='failed',lease_until=0 WHERE id=?",
      )
        .bind(task.id)
        .run();
    }
  }
  await env.DB.prepare(
    "UPDATE radar_tasks SET status='failed',lease_until=0 WHERE status IN ('queued','running') AND attempts>=12 AND lease_until<=?",
  )
    .bind(Date.now())
    .run();
  const active = await env.DB.prepare(
    "SELECT id FROM radar_runs WHERE status IN ('queued','running') AND NOT EXISTS(SELECT 1 FROM radar_tasks WHERE run_id=radar_runs.id AND status IN ('queued','running'))",
  ).all<{ id: string }>();
  for (const run of active.results)
    await env.DB.prepare(
      "UPDATE radar_runs SET status=CASE WHEN EXISTS(SELECT 1 FROM radar_tasks WHERE run_id=? AND status='failed') THEN 'partial' ELSE 'complete' END,finished_at=? WHERE id=?",
    )
      .bind(run.id, now(), run.id)
      .run();
}
export async function scheduleRadar(env: Env) {
  const rows = await env.DB.prepare(
    "SELECT owner_id,payload FROM radar_settings WHERE next_run_at<=? AND json_extract(payload,'$.enabled')=1 LIMIT 5",
  )
    .bind(now())
    .all<{ owner_id: string; payload: string }>();
  for (const row of rows.results) {
    const config = JSON.parse(row.payload) as RadarConfig;
    try {
      await startRadarRun(env, row.owner_id, false);
    } catch {
      /* Source setup errors are surfaced by the next manual run. */
    }
    await env.DB.prepare(
      "UPDATE radar_settings SET next_run_at=? WHERE owner_id=? AND payload=?",
    )
      .bind(
        nextRadarDate(
          config.discoveryFrequency,
          config.timezone,
          config.emailTime,
          config.emailWeekday,
          config.emailMonthday,
        ),
        row.owner_id,
        row.payload,
      )
      .run();
  }
  await drainRadar(env);
  await env.DB.prepare("DELETE FROM radar_runs WHERE finished_at<?")
    .bind(new Date(Date.now() - 30 * 86400000).toISOString())
    .run();
}
