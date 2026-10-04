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
import { learningContentSchema, learningUsername } from "../shared/learning";
import { DEMO_STATS, DEMO_WEEKS } from "../src/features/learn/demo";
import {
  buildSolvedByDay,
  solvedSlugs,
} from "../src/features/learn/foundations/leetcodeMetrics";
import {
  freshTimer,
  pausedTimer,
  restoredTimer,
  startedTimer,
  timerRemaining,
} from "../src/features/learn/timer";

let miniflare: Miniflare;
let env: Env;
const owner = "local-manav";
const content = {
  weeks: [
    {
      ...DEMO_WEEKS[0],
      title: "Authored live week",
      slides: [{ content: "# Authored source slide" }],
      tasks: [{ id: "source-task", label: "Shared source task" }],
    },
  ],
};
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

describe("shared learning source", () => {
  it("requires authentication before any upstream request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    for (const path of ["content", "stats", "progress"])
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
  it("uses live authored content and serves last successful content during an outage", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(content))
      .mockRejectedValue(new Error("upstream unavailable"));
    vi.stubGlobal("fetch", fetch);
    const first = await request("/api/learning/content");
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      data: content,
      source: { stale: false },
    });
    await request("/api/learning/content");
    expect(fetch).toHaveBeenCalledTimes(1);
    await env.DB.prepare(
      "UPDATE learning_source_cache SET fetched_at=? WHERE owner_id=?",
    )
      .bind("2000-01-01T00:00:00.000Z", owner)
      .run();
    const fallback = await request("/api/learning/content");
    expect(await fallback.json()).toMatchObject({
      data: content,
      source: { stale: true, fetchedAt: "2000-01-01T00:00:00.000Z" },
    });
    expect(fetch.mock.calls[0][0]).toBe(
      "https://manavdodia.com/api/admin/content",
    );
    expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  });
  it("rejects malformed upstream data without replacing the last successful copy", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(content))
      .mockResolvedValueOnce(json({ weeks: "untrusted" }));
    vi.stubGlobal("fetch", fetch);
    await request("/api/learning/content");
    await env.DB.prepare(
      "UPDATE learning_source_cache SET fetched_at=? WHERE owner_id=?",
    )
      .bind("2000-01-01T00:00:00.000Z", owner)
      .run();
    const fallback = await request("/api/learning/content");
    expect(await fallback.json()).toMatchObject({
      data: content,
      source: { stale: true },
    });
    const row = await env.DB.prepare(
      "SELECT payload FROM learning_source_cache WHERE owner_id=?",
    )
      .bind(owner)
      .first<{ payload: string }>();
    expect(JSON.parse(row!.payload)).toEqual(content);
  });
  it("fails visibly when no successful curriculum copy is available", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ weeks: [] })));
    expect((await request("/api/learning/content")).status).toBe(502);
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
  it("does not fetch profiles or permit task writes before identity is configured", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await (await request("/api/learning/stats")).json()).toMatchObject({
      data: null,
      configured: false,
    });
    expect(
      await (await request("/api/learning/progress")).json(),
    ).toMatchObject({ data: { tasks: {} }, configured: false });
    expect(
      (
        await request("/api/learning/progress", "POST", {
          taskId: "source-task",
          done: true,
        })
      ).status,
    ).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("writes only source task completion with the configured handle, then reads the same response", async () => {
    await setHandle("synthetic-handle");
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(content))
      .mockResolvedValueOnce(json({ tasks: { "source-task": true } }));
    vi.stubGlobal("fetch", fetch);
    const response = await request("/api/learning/progress", "POST", {
      taskId: "source-task",
      done: true,
    });
    expect(response.status).toBe(200);
    expect(fetch.mock.calls[1][0]).toBe("https://manavdodia.com/api/progress");
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({
      username: "synthetic-handle",
      taskId: "source-task",
      done: true,
    });
    const refreshed = await request("/api/learning/progress");
    expect(await refreshed.json()).toMatchObject({
      data: { tasks: { "source-task": true } },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      (
        await request("/api/learning/progress", "POST", {
          taskId: "source-task",
          done: "false",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/api/learning/progress", "POST", {
          username: "foreign",
          taskId: "source-task",
          done: true,
        })
      ).status,
    ).toBe(400);
  });
  it("rejects tasks outside the shared curriculum and reports failed writes", async () => {
    await setHandle("synthetic-handle");
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(content))
      .mockRejectedValue(new Error("outage"));
    vi.stubGlobal("fetch", fetch);
    expect(
      (
        await request("/api/learning/progress", "POST", {
          taskId: "private-career-goal",
          done: true,
        })
      ).status,
    ).toBe(400);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      (
        await request("/api/learning/progress", "POST", {
          taskId: "source-task",
          done: true,
        })
      ).status,
    ).toBe(502);
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
  it("rejects another profile before it can enter the configured account cache", async () => {
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
  it("bounds upstream responses and times out stalled fetches", async () => {
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
      fetchLearningSource("/api/admin/content", learningContentSchema),
    ).rejects.toThrow("too large");
    await expect(
      fetchLearningSource("https://attacker.invalid/", learningContentSchema),
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
      fetchLearningSource("/api/admin/content", learningContentSchema),
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
  it("restores a running timer from its deadline, including elapsed background time", () => {
    const running = startedTimer(freshTimer(), 1000);
    expect(
      timerRemaining(
        restoredTimer(JSON.parse(JSON.stringify(running)), 61_000),
        61_000,
      ),
    ).toBe(24 * 60_000);
    const finished = restoredTimer(running, 2_000_000);
    expect(finished.endsAt).toBeNull();
    expect(timerRemaining(finished)).toBe(0);
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
