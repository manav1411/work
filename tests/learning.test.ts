import { readFileSync } from "node:fs";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { app } from "../worker";
import type { Env } from "../worker/env";
import { fetchLearningSource } from "../worker/learning";
import { DEFAULT_PREFERENCES } from "../shared/model";
import { learningStatsSchema, learningUsername } from "../shared/learning";
import { DEMO_STATS } from "../src/features/learn/demo";
import {
  buildSolvedByDay,
  solvedSlugs,
} from "../src/features/learn/foundations/leetcodeMetrics";
import {
  freshTimer,
  pausedTimer,
  restoredTimer,
  advancedTimer,
  startedTimer,
  timerRemaining,
} from "../src/features/learn/timer";

let miniflare: Miniflare;
let env: Env;
const owner = "local-manav";
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
function request(
  path: string,
  method = "GET",
  body?: unknown,
  environment = env,
) {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: body
        ? { "Content-Type": "application/json", Origin: "http://localhost" }
        : {},
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    environment,
  );
}
async function setHandle(handle: string) {
  await env.DB.prepare(
    "INSERT INTO preferences(owner_id,data,updated_at) VALUES(?,?,?) ON CONFLICT(owner_id) DO UPDATE SET data=excluded.data",
  )
    .bind(
      owner,
      JSON.stringify({
        ...DEFAULT_PREFERENCES,
        leetcode: `https://leetcode.com/u/${handle}/`,
      }),
      new Date().toISOString(),
    )
    .run();
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
    OWNER_GITHUB_LOGIN: "synthetic-owner",
    APP_ORIGIN: "http://localhost",
  };
  const migrations = [
    "0001_workspace.sql",
    "0002_submitted_files.sql",
    "0003_connectors.sql",
    "0004_simplification.sql",
    "0005_workspace_improvements.sql",
    "0006_backup_staging.sql",
    "0007_native_latex.sql",
  ]
    .map((name) =>
      readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"),
    )
    .join("\n");
  await env.DB.exec(migrations.replace(/--[^\n]*/g, "").replace(/\n/g, " "));
}, 30_000);
beforeEach(async () => {
  await env.DB.prepare("DELETE FROM user").run();
  await env.DB.prepare("DELETE FROM rate_limits").run();
  await request("/api/session");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
afterAll(async () => {
  await miniflare?.dispose();
}, 30_000);

describe("roadmap statistics source and retired curriculum", () => {
  it("requires authentication before statistics or retired curriculum routes", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    for (const path of ["content", "stats", "progress", "tasks", "refresh"])
      expect(
        (
          await request(`/api/learning/${path}`, "GET", undefined, {
            ...env,
            LOCAL_DEV_AUTH: "false",
          })
        ).status,
      ).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("retires reads and writes without upstream traffic or deleting retained private progress", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const inserted = await request("/api/records", "POST", {
      kind: "progress",
      title: "Retained learning task",
      data: { category: "task", taskId: "source-task", done: true },
    });
    expect(inserted.status).toBe(201);
    const saved = (await inserted.json()) as { record: { id: string } };
    for (const path of ["content", "progress", "tasks", "refresh"])
      for (const method of ["GET", "POST"])
        expect(
          (
            await request(
              `/api/learning/${path}`,
              method,
              method === "POST"
                ? { taskId: "source-task", done: false }
                : undefined,
            )
          ).status,
        ).toBe(410);
    expect(fetch).not.toHaveBeenCalled();
    expect(
      await env.DB.prepare("SELECT data FROM records WHERE id=? AND owner_id=?")
        .bind(saved.record.id, owner)
        .first(),
    ).toMatchObject({
      data: JSON.stringify({
        category: "task",
        taskId: "source-task",
        done: true,
      }),
    });
  });
  it("fetches live statistics once within the cache window and preserves last success during an outage", async () => {
    await setHandle("synthetic-handle");
    const data = { ...DEMO_STATS, username: "synthetic-handle" };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(data))
      .mockRejectedValue(new Error("unavailable"));
    vi.stubGlobal("fetch", fetch);
    expect(await (await request("/api/learning/stats")).json()).toMatchObject({
      data,
      source: { stale: false },
    });
    await request("/api/learning/stats");
    expect(fetch).toHaveBeenCalledTimes(1);
    await env.DB.prepare(
      "UPDATE learning_source_cache SET fetched_at=? WHERE owner_id=?",
    )
      .bind("2000-01-01T00:00:00.000Z", owner)
      .run();
    expect(await (await request("/api/learning/stats")).json()).toMatchObject({
      data,
      source: { stale: true, fetchedAt: "2000-01-01T00:00:00.000Z" },
    });
    expect(fetch.mock.calls[0][0]).toBe(
      "https://manavdodia.com/api/leetcode?username=synthetic-handle",
    );
    expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  });
  it("rejects malformed statistics without replacing the last successful copy", async () => {
    await setHandle("synthetic-handle");
    const data = { ...DEMO_STATS, username: "synthetic-handle" };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(json(data))
        .mockResolvedValueOnce(json({ solved: "untrusted" })),
    );
    await request("/api/learning/stats");
    await env.DB.prepare(
      "UPDATE learning_source_cache SET fetched_at=? WHERE owner_id=?",
    )
      .bind("2000-01-01T00:00:00.000Z", owner)
      .run();
    expect(await (await request("/api/learning/stats")).json()).toMatchObject({
      data,
      source: { stale: true },
    });
    const row = await env.DB.prepare(
      "SELECT payload FROM learning_source_cache WHERE owner_id=? AND source_key=?",
    )
      .bind(owner, "stats:synthetic-handle")
      .first<{ payload: string }>();
    expect(JSON.parse(row!.payload)).toEqual(data);
  });
  it("fails visibly when no successful statistics copy is available", async () => {
    await setHandle("synthetic-handle");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ solved: [] })));
    expect((await request("/api/learning/stats")).status).toBe(502);
  });
  it("derives the handle from owner preferences and ignores client-selected identities", async () => {
    await setHandle("synthetic-handle");
    const fetch = vi
      .fn()
      .mockResolvedValue(json({ ...DEMO_STATS, username: "synthetic-handle" }));
    vi.stubGlobal("fetch", fetch);
    const response = await request(
      "/api/learning/stats?username=another-user&owner_id=foreign",
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      username: "synthetic-handle",
      configured: true,
    });
    expect(fetch.mock.calls[0][0]).toBe(
      "https://manavdodia.com/api/leetcode?username=synthetic-handle",
    );
    expect(fetch.mock.calls[0][1].headers).not.toHaveProperty("Cookie");
  });
  it("does not fetch profiles before identity is configured", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await (await request("/api/learning/stats")).json()).toMatchObject({
      data: null,
      configured: false,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps cached statistics isolated when changing handles", async () => {
    await setHandle("first-handle");
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json({ ...DEMO_STATS, username: "first-handle" }))
      .mockRejectedValue(new Error("outage"));
    vi.stubGlobal("fetch", fetch);
    expect((await request("/api/learning/stats")).status).toBe(200);
    await setHandle("second-handle");
    expect((await request("/api/learning/stats")).status).toBe(502);
    expect(fetch.mock.calls[1][0]).toBe(
      "https://manavdodia.com/api/leetcode?username=second-handle",
    );
  });
  it("rejects another profile before it enters the account cache", async () => {
    await setHandle("synthetic-handle");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(DEMO_STATS)));
    expect((await request("/api/learning/stats")).status).toBe(502);
    expect(
      await env.DB.prepare(
        "SELECT payload FROM learning_source_cache WHERE owner_id=? AND source_key=?",
      )
        .bind(owner, "stats:synthetic-handle")
        .first(),
    ).toBeNull();
  });
  it("bounds and times out upstream responses, and prohibits retired source paths", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("{}", {
          headers: {
            "Content-Type": "application/json",
            "Content-Length": "5000000",
          },
        }),
      ),
    );
    await expect(
      fetchLearningSource(
        "/api/leetcode?username=synthetic-handle",
        learningStatsSchema,
      ),
    ).rejects.toThrow("too large");
    for (const path of [
      "https://attacker.invalid/",
      "/api/admin/content",
      "/api/progress?username=synthetic-handle",
      "/api/progress",
    ])
      await expect(
        fetchLearningSource(path, learningStatsSchema),
      ).rejects.toThrow("Invalid learning source");
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, init: RequestInit) =>
          new Promise((_resolve, reject) =>
            init.signal?.addEventListener("abort", () =>
              reject(new Error("aborted")),
            ),
          ),
      ),
    );
    const stalled = expect(
      fetchLearningSource(
        "/api/leetcode?username=synthetic-handle",
        learningStatsSchema,
      ),
    ).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(12_000);
    await stalled;
  });
});

describe("learning foundations and timer", () => {
  it("uses accumulated history and deduplicates feed solves rather than counting attempts", () => {
    const stats = {
      recent: [
        { title: "Two Sum", titleSlug: "two-sum", timestamp: "100000" },
        { title: "Two Sum", titleSlug: "two-sum", timestamp: "200000" },
      ],
    };
    expect([...solvedSlugs(buildSolvedByDay(stats))]).toEqual(["two-sum"]);
    expect([
      ...solvedSlugs(
        buildSolvedByDay({
          ...stats,
          solvedDays: {
            "86400": [{ title: "Older Problem", titleSlug: "older-problem" }],
          },
        }),
      ),
    ]).toEqual(["older-problem"]);
  });
  it("recognizes only LeetCode handles and profile URLs", () => {
    expect(learningUsername("https://leetcode.com/u/synthetic-handle/")).toBe(
      "synthetic-handle",
    );
    expect(learningUsername(" @synthetic-handle ")).toBe("synthetic-handle");
    for (const value of [
      "https://attacker.invalid/u/example",
      "https://leetcode.com.attacker.invalid/u/example",
      "https://leetcode.com/problems/two-sum",
      "file:///u/example",
    ])
      expect(learningUsername(value)).toBe("");
  });
  it("keeps a running timer accurate across the focus and break loop", () => {
    const running = startedTimer(freshTimer(), 1000);
    expect(
      timerRemaining(
        restoredTimer(JSON.parse(JSON.stringify(running)), 61_000),
        61_000,
      ),
    ).toBe(24 * 60_000);
    const breakStarted = advancedTimer(running, 1_501_000);
    expect(breakStarted.phase).toBe("break");
    expect(breakStarted.endsAt).toBe(1_801_000);
    expect(timerRemaining(breakStarted, 1_501_000)).toBe(5 * 60_000);
    expect(breakStarted.alerting).toBe(true);

    const nextFocus = advancedTimer(breakStarted, 1_801_000);
    expect(nextFocus.phase).toBe("work");
    expect(nextFocus.endsAt).toBe(3_301_000);
    expect(timerRemaining(nextFocus, 1_801_000)).toBe(25 * 60_000);

    const restoredAfterSleep = restoredTimer(running, 2_000_000);
    expect(restoredAfterSleep.phase).toBe("work");
    expect(restoredAfterSleep.endsAt).toBe(3_301_000);
    expect(restoredAfterSleep.alerting).toBe(true);
    expect(timerRemaining(restoredAfterSleep, 2_000_000)).toBe(1_301_000);
  });
  it("pause/resume preserves remaining duration and invalid stored state recovers", () => {
    const paused = pausedTimer(startedTimer(freshTimer(), 1000), 31_000);
    expect(timerRemaining(paused, 9_999_999)).toBe(24.5 * 60_000);
    const resumed = startedTimer(paused, 5_000_000);
    expect(timerRemaining(resumed, 5_030_000)).toBe(24 * 60_000);
    expect(restoredTimer({ phase: "work", endsAt: "invalid" })).toEqual(
      freshTimer(),
    );
  });
});
