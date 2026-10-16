import { readFileSync } from "node:fs";
import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { app } from "../worker";
import {
  defaultRadarConfig,
  jobSchema,
  identityKeys,
  profileMatches,
  nextRadarDate,
  semanticJob,
  type RadarJob,
  type Opportunity,
} from "../shared/radar";
import {
  commonRecruitmentProcess,
  selectApplicationStatus,
} from "../shared/applications";
import { ingestJob, getOpportunity } from "../worker/radar-store";
import { drainRadar, startRadarRun } from "../worker/radar-runner";
import { reserveUsage, scoreKey } from "../worker/radar-jev";
import {
  employerBoard,
  normalizeJSearch,
  normalizeBoard,
  normalizeApify,
} from "../worker/radar-sources";
import { enqueueRadarDigest, drainRadarMail } from "../worker/radar-mail";
import {
  workspaceManifestSchema,
  workspacePackageError,
  remapWorkspace,
  type WorkspaceManifest,
} from "../shared/transfer";
import type { Env } from "../worker/env";

const at = "2026-10-16T00:00:00.000Z";
function job(patch: Partial<RadarJob> = {}): RadarJob {
  return jobSchema.parse({
    company: "Google",
    companyUrl: "https://google.com",
    companyId: "",
    title: "Junior software engineer",
    description:
      "Build services and APIs. Graduate and junior developers welcome.",
    locations: ["Melbourne, Australia"],
    country: "au",
    workplace: "hybrid",
    remoteRegions: [],
    salary: null,
    employmentType: "Full-time",
    seniority: "Junior",
    requisitionId: "",
    requisitionNamespace: "",
    postedAt: at,
    closingDate: "",
    closed: false,
    sources: [
      {
        provider: "jsearch",
        publisher: "LinkedIn",
        sourceId: "posting-1",
        url: "https://www.linkedin.com/jobs/view/1234",
        applyUrl: "",
        observedAt: at,
      },
    ],
    ...patch,
  });
}
describe("opportunity semantics", () => {
  it("uses a shared employer application URL across boards without treating a careers homepage as a vacancy", () => {
    const a = job({
        sources: [
          {
            ...job().sources[0],
            applyUrl:
              "https://jobs.lever.co/acme/vacancy-123?utm_source=linkedin",
          },
        ],
      }),
      b = job({
        sources: [
          {
            ...job().sources[0],
            sourceId: "seek-other",
            url: "https://seek.com.au/job/123",
            applyUrl: "https://jobs.lever.co/acme/vacancy-123",
          },
        ],
      });
    expect(
      identityKeys(a).filter((k) => identityKeys(b).includes(k)),
    ).toContain("url:https://jobs.lever.co/acme/vacancy-123");
    expect(
      identityKeys(
        job({
          sources: [
            {
              ...job().sources[0],
              sourceId: "",
              url: "https://acme.example/careers/",
            },
          ],
        }),
      ),
    ).toEqual([]);
  });
  it("does not use a SEEK employer's hidden salary bounds to discard a listing", () => {
    const out = normalizeApify(
      {
        id: "123",
        title: "Junior software engineer",
        company_name: "Acme",
        location: "Melbourne",
        salary_hiden: true,
        salary_minimum: 50000,
        salary_maximum: 60000,
        salary_currency: "AUD",
        salary_period: "AnnualPackage",
      },
      "saswave/seek-scraper",
      at,
    );
    expect(out?.salary).toBeNull();
    expect(
      out &&
        profileMatches(out, {
          ...defaultRadarConfig().profiles[0],
          salaryMin: 100000,
        }),
    ).toBe(true);
  });
  it("keeps employer roles distinct while identifying exact source aliases and requisitions", () => {
    expect(
      identityKeys(
        job({
          title: "Network engineer",
          sources: [
            {
              ...job().sources[0],
              sourceId: "posting-2",
              url: "https://www.linkedin.com/jobs/view/2345",
            },
          ],
        }),
      ),
    ).not.toEqual(identityKeys(job()));
    const a = job({
      requisitionId: "g123",
      requisitionNamespace: "google.com",
    });
    const b = job({
      requisitionId: "g123",
      requisitionNamespace: "google.com",
      sources: [
        {
          ...job().sources[0],
          publisher: "SEEK",
          provider: "apify",
          sourceId: "seek:12",
          url: "https://www.seek.com.au/job/12",
        },
      ],
    });
    expect(
      identityKeys(a).filter((k) => identityKeys(b).includes(k)),
    ).toContain("req:google.com:g123");
    expect(
      identityKeys(
        job({ requisitionId: "g456", requisitionNamespace: "google.com" }),
      ),
    ).not.toContain("req:google.com:g123");
  });
  it("includes unknown salaries, uses comparable overlapping bounds, and keeps remote uncertainty", () => {
    const p = {
      ...defaultRadarConfig().profiles[0],
      salaryMin: 110000,
      salaryMax: 150000,
    };
    expect(profileMatches(job(), p)).toBe(true);
    const salary = {
      min: 90000,
      max: 130000,
      currency: "AUD",
      period: "year" as const,
      text: "",
      estimated: false,
    };
    expect(profileMatches(job({ salary }), p)).toBe(true);
    expect(profileMatches(job({ salary: { ...salary, max: 100000 } }), p)).toBe(
      false,
    );
    expect(
      profileMatches(
        job({ salary: { ...salary, max: 100000, estimated: true } }),
        p,
      ),
    ).toBe(true);
    expect(
      profileMatches(
        job({ salary: { ...salary, currency: "USD", max: 100000 } }),
        p,
      ),
    ).toBe(true);
    expect(
      profileMatches(job({ workplace: "remote", locations: ["Australia"] }), p),
    ).toBe(true);
    expect(profileMatches(job({ country: "us", workplace: "remote" }), p)).toBe(
      false,
    );
  });
  it("normalizes long JSearch IDs and source fields without fabricating currency", () => {
    const out = normalizeJSearch(
      {
        job_id: "x".repeat(900),
        job_uid: "short-id",
        job_title: "Software engineer",
        employer_name: "Google",
        job_apply_link: "https://linkedin.com/jobs/view/1234",
        job_description: "Body",
        job_country: "United States",
        job_min_salary: 100000,
        job_salary_period: "YEAR",
        job_offer_expiration_datetime_utc: "2026-10-30T00:00:00Z",
      },
      at,
    );
    expect(out).toMatchObject({
      country: "us",
      closingDate: "2026-10-30",
      salary: { currency: "", period: "year" },
    });
    expect(out?.sources[0].sourceId).toBe("short-id");
  });
  it("only accesses fixed supported employer hosts and excludes unlisted Ashby posts", () => {
    expect(employerBoard("https://jobs.ashbyhq.com/acme")).toMatchObject({
      type: "ashby",
      slug: "acme",
    });
    for (const u of [
      "http://127.0.0.1/secret",
      "https://jobs.ashbyhq.com.evil.invalid/acme",
      "https://jobs.lever.co@127.0.0.1/acme",
      "https://jobs.lever.co:999/acme",
    ])
      expect(employerBoard(u)).toBeNull();
    expect(
      normalizeBoard(
        "ashby",
        "acme",
        "Acme",
        "",
        {
          isListed: false,
          title: "Hidden",
          jobUrl: "https://jobs.ashbyhq.com/acme/1",
        },
        at,
      ),
    ).toBeNull();
  });
  it("ignores state changes in the semantic cache but includes profile and personal context", async () => {
    const j = job(),
      cfg = defaultRadarConfig(),
      p = cfg.profiles[0];
    const extra = {
      ...j,
      id: "job",
      flagged: true,
      version: 9,
      notes: "My private note",
      assessment: null,
    } as Opportunity;
    expect(semanticJob(extra)).toEqual(semanticJob(j));
    expect(await scoreKey(j, p, cfg)).toBe(await scoreKey(extra, p, cfg));
    expect(
      await scoreKey(j, p, { ...cfg, aboutYou: "New experience" }),
    ).not.toBe(await scoreKey(j, p, cfg));
  });
  it("schedules local dates across DST and clamps monthly dates", () => {
    expect(
      nextRadarDate(
        "daily",
        "Australia/Melbourne",
        "08:00",
        1,
        1,
        new Date("2026-10-03T23:00:00Z"),
      ),
    ).toBe("2026-10-04T21:00:00.000Z");
    expect(
      nextRadarDate(
        "monthly",
        "Australia/Melbourne",
        "08:00",
        1,
        31,
        new Date("2026-02-01T00:00:00Z"),
      ),
    ).toBe("2026-02-27T21:00:00.000Z");
    expect(
      nextRadarDate("disabled", "Australia/Melbourne", "08:00", 1, 1),
    ).toBeNull();
  });
});

let runtime: Miniflare, env: Env, owner: string, epoch: string;
async function send(path: string, method = "GET", body?: unknown) {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        "X-Workspace-Epoch": epoch || "",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
}
async function setup(config = defaultRadarConfig()) {
  const response = await send("/api/radar/settings", "PUT", {
    config,
    version: 0,
  });
  expect(response.status, await response.clone().text()).toBe(200);
  return config;
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
    APP_ORIGIN: "http://localhost",
  };
  for (const name of [
    "0001_workspace.sql",
    "0009_current_workspace.sql",
    "0010_goal_actions.sql",
    "0011_email_auth.sql",
    "0012_radar.sql",
  ])
    await env.DB.exec(
      readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8")
        .replace(/--[^\n]*/g, "")
        .replace(/\n/g, " "),
    );
}, 30000);
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM user"),
    env.DB.prepare("DELETE FROM rate_limits"),
    env.DB.prepare("DELETE FROM radar_usage"),
  ]);
  delete env.JSEARCH_API_KEY;
  delete env.TYPESAFE_API_KEY;
  delete env.APIFY_TOKEN;
  delete env.AUTH_MAILER_URL;
  delete env.BETTER_AUTH_SECRET;
  const session = await send("/api/session");
  owner = ((await session.json()) as { user: { id: string } }).user.id;
  const records = await send("/api/records");
  epoch = ((await records.json()) as { epoch: string }).epoch;
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => runtime?.dispose());
describe("Radar persistence and workflow", () => {
  it("does not leave duplicate opportunities when two source ingestions race", async () => {
    const results = await Promise.allSettled([
      ingestJob(env.DB, owner, job(), []),
      ingestJob(env.DB, owner, job(), []),
    ]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(
      (
        await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM radar_opportunities WHERE owner_id=?",
        )
          .bind(owner)
          .first<{ n: number }>()
      )?.n,
    ).toBe(1);
  });
  it("waits for an exhausted task's lease before reporting the run as partial", async () => {
    await setup();
    const run = await startRadarRun(env, owner, true);
    await env.DB.prepare(
      "UPDATE radar_tasks SET attempts=12,lease_until=? WHERE run_id=?",
    )
      .bind(Date.now() + 90000, run)
      .run();
    await drainRadar(env, 0);
    expect(
      (
        await env.DB.prepare("SELECT status FROM radar_runs WHERE id=?")
          .bind(run)
          .first<{ status: string }>()
      )?.status,
    ).toBe("queued");
    await env.DB.prepare("UPDATE radar_tasks SET lease_until=0 WHERE run_id=?")
      .bind(run)
      .run();
    await drainRadar(env, 0);
    expect(
      (
        await env.DB.prepare("SELECT status FROM radar_runs WHERE id=?")
          .bind(run)
          .first<{ status: string }>()
      )?.status,
    ).toBe("partial");
  });
  it("filters comparable salary and dates while retaining incomplete information", async () => {
    await setup();
    const a = await ingestJob(env.DB, owner, job(), ["software-au"]);
    await ingestJob(
      env.DB,
      owner,
      job({
        sources: [
          {
            ...job().sources[0],
            sourceId: "low-pay",
            url: "https://seek.com.au/job/777",
          },
        ],
        salary: {
          min: 50000,
          max: 60000,
          currency: "AUD",
          period: "year",
          estimated: false,
          text: "",
        },
        postedAt: "2025-01-01T00:00:00.000Z",
      }),
      ["software-au"],
    );
    const response = await send(
      "/api/radar/opportunities?minSalary=100000&currency=AUD&period=year&postedAfter=2026-01-01&employmentType=full&seniority=junior",
    );
    expect(response.status).toBe(200);
    expect(
      (
        (await response.json()) as { opportunities: Opportunity[] }
      ).opportunities.map((o) => o.id),
    ).toEqual([a.id]);
  });
  it("merges confirmed duplicates, retains all source identities and saved flags, and rejects conflicting requisitions", async () => {
    await setup();
    const a = await ingestJob(env.DB, owner, job(), []);
    const b = await ingestJob(
      env.DB,
      owner,
      job({
        sources: [
          {
            ...job().sources[0],
            sourceId: "seek-copy",
            url: "https://www.seek.com.au/job/888",
          },
        ],
      }),
      [],
    );
    await send(`/api/radar/opportunities/${a.id}/state`, "PATCH", {
      version: 1,
      saved: true,
      flagged: true,
    });
    const response = await send(
      `/api/radar/opportunities/${a.id}/merge`,
      "POST",
      { targetId: b.id, version: 2, targetVersion: 1 },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const merged = await getOpportunity(env.DB, owner, b.id);
    expect(merged).toMatchObject({ saved: true, flagged: true });
    expect(merged.sources).toHaveLength(2);
    expect((await ingestJob(env.DB, owner, job(), [])).id).toBe(b.id);
    const c = await ingestJob(
      env.DB,
      owner,
      job({
        requisitionId: "a",
        requisitionNamespace: "google",
        sources: [
          {
            ...job().sources[0],
            sourceId: "req-a",
            url: "https://linkedin.com/jobs/view/44",
          },
        ],
      }),
      [],
    );
    const d = await ingestJob(
      env.DB,
      owner,
      job({
        requisitionId: "b",
        requisitionNamespace: "google",
        sources: [
          {
            ...job().sources[0],
            sourceId: "req-b",
            url: "https://linkedin.com/jobs/view/45",
          },
        ],
      }),
      [],
    );
    expect(
      (
        await send(`/api/radar/opportunities/${c.id}/merge`, "POST", {
          targetId: d.id,
          version: 1,
          targetVersion: 1,
        })
      ).status,
    ).toBe(409);
  });
  it("deduplicates reruns and cross-source requisitions, keeping other roles separate", async () => {
    const j = job({ requisitionId: "r1", requisitionNamespace: "google" });
    const a = await ingestJob(env.DB, owner, j, ["software-au"]);
    const b = await ingestJob(
      env.DB,
      owner,
      {
        ...j,
        sources: [
          {
            ...j.sources[0],
            provider: "apify",
            publisher: "SEEK",
            sourceId: "seek-1",
            url: "https://seek.com.au/job/99",
          },
        ],
      },
      ["software-au"],
    );
    expect(a.id).toBe(b.id);
    expect(b.created).toBe(false);
    const c = await ingestJob(
      env.DB,
      owner,
      job({
        title: "Network engineer",
        requisitionId: "r2",
        requisitionNamespace: "google",
        sources: [
          {
            ...j.sources[0],
            sourceId: "posting-other",
            url: "https://linkedin.com/jobs/view/9999",
          },
        ],
      }),
      [],
    );
    expect(c.id).not.toBe(a.id);
    expect((await getOpportunity(env.DB, owner, a.id)).sources).toHaveLength(2);
  });
  it("saves and flags independently, hides a tracked job atomically, and preserves it after application deletion", async () => {
    await setup();
    const { id } = await ingestJob(env.DB, owner, job(), ["software-au"]);
    let o = await getOpportunity(env.DB, owner, id);
    expect(
      (
        await send(`/api/radar/opportunities/${id}/state`, "PATCH", {
          version: o.version,
          flagged: true,
        })
      ).status,
    ).toBe(200);
    o = await getOpportunity(env.DB, owner, id);
    const draft = {
      id: "new",
      kind: "application",
      title: o.title,
      body: "",
      tags: [],
      links: [],
      version: 1,
      createdAt: at,
      updatedAt: at,
      data: { processVersion: 2, recruitmentSteps: commonRecruitmentProcess() },
    } as const;
    const data = selectApplicationStatus(
      { ...draft, links: [], tags: [] },
      "Applied",
      "2026-10-16",
    );
    const input = {
      kind: "application",
      title: o.title,
      data: { ...data, company: o.company, url: o.sources[0].url },
    };
    const results = await Promise.all([
      send(`/api/radar/opportunities/${id}/application`, "POST", input),
      send(`/api/radar/opportunities/${id}/application`, "POST", input),
    ]);
    const ids = await Promise.all(
      results.map(async (r) => {
        expect(r.status, await r.clone().text()).toBeLessThan(300);
        return ((await r.json()) as { record: { id: string } }).record.id;
      }),
    );
    expect(new Set(ids).size).toBe(1);
    const page = await send("/api/radar/opportunities");
    expect(
      ((await page.json()) as { opportunities: Opportunity[] }).opportunities,
    ).toHaveLength(0);
    expect((await getOpportunity(env.DB, owner, id)).flagged).toBe(true);
    await send(`/api/records/${ids[0]}`, "DELETE");
    o = await getOpportunity(env.DB, owner, id);
    expect(o.tracked).toBe(true);
    expect(o.applicationId).toBe("");
    expect(
      (
        await send(`/api/radar/opportunities/${id}/state`, "PATCH", {
          version: o.version,
          restore: true,
        })
      ).status,
    ).toBe(200);
  });
  it("enforces optimistic updates, owner scope and a zero-cost missing-provider fallback", async () => {
    const config = await setup();
    config.sources[0].enabled = true;
    expect(
      (await send("/api/radar/settings", "PUT", { config, version: 0 })).status,
    ).toBe(409);
    const { id } = await ingestJob(env.DB, owner, job(), ["software-au"]);
    expect(
      (
        await send(`/api/radar/opportunities/${id}/state`, "PATCH", {
          version: 999,
          flagged: true,
        })
      ).status,
    ).toBe(409);
    expect((await send("/api/radar/opportunities/nonexistent")).status).toBe(
      404,
    );
    const runId = await startRadarRun(env, owner, true);
    await drainRadar(env, 30);
    const run = await env.DB.prepare(
      "SELECT status,messages FROM radar_runs WHERE id=?",
    )
      .bind(runId)
      .first<{ status: string; messages: string }>();
    expect(run?.status).toBe("partial");
    expect(run?.messages).toContain("not configured");
    expect((await getOpportunity(env.DB, owner, id)).assessment).toBeNull();
  });
  it("atomically reserves a shared-key allowance under competing workers", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        reserveUsage(env, "test", "shared-token", 1, 3),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    const row = await env.DB.prepare(
      "SELECT units FROM radar_usage WHERE provider='test'",
    ).first<{ units: number }>();
    expect(row?.units).toBe(3);
  });
  it("reuses cached multi-dimension scores when unchanged jobs are rediscovered", async () => {
    const config = defaultRadarConfig();
    config.profiles = config.profiles.slice(0, 1);
    config.profiles[0].locations = ["Melbourne"];
    await setup(config);
    env.JSEARCH_API_KEY = "synthetic-jsearch";
    env.TYPESAFE_API_KEY = "synthetic-jev";
    let scoreCalls = 0,
      searchCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (endpoint: string, init?: RequestInit) => {
        if (String(endpoint).includes("openwebninja")) {
          searchCalls++;
          return Response.json({
            status: "OK",
            data: {
              jobs: [
                {
                  job_uid: "job-1",
                  job_title: "Junior software engineer",
                  employer_name: "Google",
                  job_apply_link: "https://linkedin.com/jobs/view/1234",
                  job_description: "Build software",
                  job_location: "Melbourne",
                  job_country: "AU",
                },
              ],
            },
          });
        }
        scoreCalls++;
        const body = JSON.parse(String(init?.body));
        expect(Object.keys(body.questions)).toContain("qualification");
        return Response.json({
          model: "jev-1.13.0",
          usage: { input_tokens: 500 },
          answers: {
            interest: { score: 3.2, confidence: 0.85 },
            qualification: { score: 2 },
            seniority: { score: 4 },
            information: { choice: "insufficient" },
            feasibility: { choice: "unclear" },
            reason: { choice: "work" },
          },
        });
      }),
    );
    const run = await startRadarRun(env, owner, true);
    await drainRadar(env, 5);
    await drainRadar(env, 5);
    await drainRadar(env, 5);
    expect(scoreCalls).toBe(1);
    expect(searchCalls).toBe(1);
    await env.DB.prepare("UPDATE radar_runs SET created_at=? WHERE id=?")
      .bind("2026-01-01", run)
      .run();
    await startRadarRun(env, owner, true);
    await drainRadar(env, 5);
    await drainRadar(env, 5);
    await drainRadar(env, 5);
    expect(searchCalls).toBe(2);
    expect(scoreCalls).toBe(1);
    const out = await send("/api/radar/opportunities");
    const jobs = ((await out.json()) as { opportunities: Opportunity[] })
      .opportunities;
    expect(jobs[0].assessment).toMatchObject({
      interest: 80,
      qualification: null,
    });
  });
  it("rejects completions after preferences change during a network call", async () => {
    const config = defaultRadarConfig();
    config.profiles = config.profiles.slice(0, 1);
    config.profiles[0].locations = ["Melbourne"];
    await setup(config);
    env.JSEARCH_API_KEY = "synthetic";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await env.DB.prepare(
          "UPDATE radar_settings SET version=version+1 WHERE owner_id=?",
        )
          .bind(owner)
          .run();
        return Response.json({
          status: "OK",
          data: {
            jobs: [
              {
                job_uid: "race-job",
                job_title: "Junior software engineer",
                employer_name: "Google",
                job_apply_link: "https://linkedin.com/jobs/view/1234",
                job_country: "AU",
              },
            ],
          },
        });
      }),
    );
    await startRadarRun(env, owner, true);
    await drainRadar(env, 1);
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM radar_opportunities",
    ).first<{ n: number }>();
    expect(count?.n).toBe(0);
  });
  it("exports strict Radar data, remaps links, and pauses imported automation", async () => {
    const config = await setup();
    const { id } = await ingestJob(env.DB, owner, job(), ["software-au"]);
    const manifest: WorkspaceManifest = {
      format: "work-workspace",
      version: 2,
      exportedAt: at,
      records: [],
      goals: [],
      preferences: {
        timezone: "Australia/Melbourne",
        theme: "light",
        displayName: "",
        leetcode: "",
      },
      attachments: [],
      radar: {
        config: { ...config, enabled: true },
        opportunities: [await getOpportunity(env.DB, owner, id)],
      },
    };
    expect(workspaceManifestSchema.safeParse(manifest).success).toBe(true);
    expect(workspacePackageError(manifest)).toBeNull();
    const next = remapWorkspace(
      manifest,
      new Map([[id, "remapped-opportunity"]]),
    );
    expect(next.radar?.config.enabled).toBe(false);
    expect(next.radar?.opportunities[0].id).toBe("remapped-opportunity");
    const upload = await send("/api/workspace/uploads", "POST", manifest);
    expect(upload.status, await upload.clone().text()).toBe(201);
    const uploadId = ((await upload.json()) as { uploadId: string }).uploadId;
    const committed = await send(
      `/api/workspace/uploads/${uploadId}/commit`,
      "POST",
      {},
    );
    expect(committed.status, await committed.clone().text()).toBe(200);
    const stored = await env.DB.prepare(
      "SELECT payload FROM radar_settings WHERE owner_id=?",
    )
      .bind(owner)
      .first<{ payload: string }>();
    expect(JSON.parse(stored!.payload).enabled).toBe(false);
  });
  it("sends each new job once and excludes saved/tracked jobs from digest reservations", async () => {
    env.BETTER_AUTH_SECRET = "synthetic-secret-with-at-least-32-characters";
    env.AUTH_MAILER_URL = "http://localhost/";
    env.AUTH_MAILER_TOKEN = "synthetic-mailer-token-at-least-32-characters";
    env.AUTH_MAIL_FROM = "work@example.invalid";
    const config = defaultRadarConfig();
    config.enabled = true;
    config.emailFrequency = "daily";
    await setup(config);
    await env.DB.prepare("UPDATE user SET email_verified=1 WHERE id=?")
      .bind(owner)
      .run();
    const { id } = await ingestJob(env.DB, owner, job(), ["software-au"]);
    const queued = await enqueueRadarDigest(env, owner);
    expect(queued.count).toBe(1);
    expect((await enqueueRadarDigest(env, owner)).queued).toBe(false);
    let sent = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        sent++;
        return Response.json(
          { accepted: true, state: "accepted" },
          { status: 202 },
        );
      }),
    );
    await drainRadarMail(env);
    await drainRadarMail(env);
    expect(sent).toBe(1);
    expect((await getOpportunity(env.DB, owner, id)).notified).toBe(true);
    expect((await enqueueRadarDigest(env, owner)).count).toBe(0);
  });
});
