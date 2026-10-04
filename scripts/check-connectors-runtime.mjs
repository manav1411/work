import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";

// Execute the built application inside workerd. Node fetch mocks alone do not
// validate Workers' Request options, Web Crypto, or credential persistence.
const token = "synthetic-notion-token-for-runtime-check";
const pageId = "11111111-1111-4111-8111-111111111111";
const page = {
  object: "page",
  id: pageId,
  last_edited_time: "2026-10-04T00:00:00.000Z",
  url: `https://www.notion.so/${pageId}`,
  properties: {
    title: { type: "title", title: [{ plain_text: "Runtime note" }] },
  },
};
let notionResponse = "valid";
let learningResponse = "valid";
let learningTasks = {};
const learningContent = {
  weeks: [
    {
      week: 1,
      title: "Authored runtime curriculum",
      accessible: true,
      slides: [{ content: "# Authored runtime slide" }],
      topic2SlideStart: 0,
      topics: [
        {
          homework: [{ name: "Two Sum", slug: "two-sum", difficulty: "Easy" }],
        },
        { homework: [] },
      ],
      tasks: [{ id: "runtime-task", label: "Shared runtime task" }],
    },
  ],
};
const learningStats = {
  username: "runtime-solver",
  profile: { userAvatar: null, ranking: null },
  solved: [{ difficulty: "All", count: 3 }],
  totalQuestions: [{ difficulty: "All", count: 100 }],
  calendar: { submissions: {} },
  recent: [],
  solvedDays: { 1785456000: [{ title: "Two Sum", titleSlug: "two-sum" }] },
};
const requests = [];
const json = (value, status = 200) => Response.json(value, { status });
const miniflare = new Miniflare(
  convertV4MiniflareOptions({
    modules: [
      "index.js",
      ...readdirSync("dist/work/assets")
        .filter((file) => file.endsWith(".js"))
        .map((file) => `assets/${file}`),
    ].map((file) => ({
      type: "ESModule",
      path: resolve("dist/work", file),
    })),
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
      requests.push(`${request.method} ${url.origin}${url.pathname}`);
      if (url.origin === "https://manavdodia.com") {
        assert.equal(request.headers.has("Cookie"), false);
        assert.equal(request.headers.has("Authorization"), false);
        if (learningResponse === "unavailable") return json({}, 503);
        if (learningResponse === "malformed") return json({ weeks: "invalid" });
        if (url.pathname === "/api/admin/content") return json(learningContent);
        assert.equal(
          url.searchParams.get("username"),
          request.method === "POST" ? null : "runtime-solver",
        );
        if (url.pathname === "/api/leetcode") return json(learningStats);
        if (url.pathname === "/api/progress") {
          if (request.method === "POST") {
            assert.deepEqual(await request.json(), {
              username: "runtime-solver",
              taskId: "runtime-task",
              done: true,
            });
            learningTasks = { "runtime-task": true };
          }
          return json({ tasks: learningTasks });
        }
      }
      if (url.href === "https://api.notion.com/v1/users/me") {
        assert.equal(request.headers.get("Authorization"), `Bearer ${token}`);
        if (notionResponse === "invalid") return json({}, 401);
        if (notionResponse === "redirect")
          return new Response(null, {
            status: 302,
            headers: { Location: "https://unexpected.example/credential" },
          });
        if (notionResponse === "malformed") return json(null);
        if (notionResponse === "unavailable") return json({}, 503);
        return json({
          id: "synthetic-bot",
          bot: {
            workspace_id: "synthetic-workspace",
            workspace_name: "Runtime workspace",
          },
        });
      }
      if (url.href === "https://api.notion.com/v1/search") {
        assert.equal(request.headers.get("Authorization"), `Bearer ${token}`);
        return json({ results: [page], has_more: false });
      }
      if (url.href === `https://api.notion.com/v1/pages/${pageId}`)
        return json(page);
      if (url.href === `https://api.notion.com/v1/pages/${pageId}/markdown`)
        return json({ markdown: "# Runtime note\n\nSynthetic content." });
      if (url.href === "https://api.github.com/users/runtime-owner")
        return json({ id: 1234, login: "runtime-owner" });
      if (url.pathname === "/users/runtime-owner/repos") return json([]);
      if (url.href === "https://leetcode.com/graphql")
        return json({
          data: {
            matchedUser: {
              username: "runtime-solver",
              submitStats: {
                acSubmissionNum: [{ difficulty: "All", count: 3 }],
              },
              userCalendar: { submissionCalendar: "{}" },
            },
            allQuestionsCount: [{ difficulty: "All", count: 100 }],
            recentAcSubmissionList: [],
          },
        });
      throw new Error(
        `Unexpected outbound runtime fixture: ${url.origin}${url.pathname}`,
      );
    },
  }),
);

async function request(path, method = "GET", body, extraHeaders = {}) {
  const response = await miniflare.dispatchFetch(`http://localhost${path}`, {
    method,
    headers: {
      ...extraHeaders,
      ...(body === undefined
        ? {}
        : { "Content-Type": "application/json", Origin: "http://localhost" }),
    },
    ...(body === undefined
      ? {}
      : {
          body: JSON.stringify(body),
        }),
  });
  const value = response.headers
    .get("content-type")
    ?.includes("application/json")
    ? await response.json()
    : { message: await response.text() };
  assert.equal(
    JSON.stringify(value).includes(token),
    false,
    "Credentials must stay private",
  );
  return { status: response.status, value };
}

try {
  const builtConfig = JSON.parse(
    readFileSync("dist/work/wrangler.json", "utf8"),
  );
  assert.equal(
    builtConfig.triggers?.crons?.length ?? 0,
    0,
    "Retired provider jobs must not be deployed with cron triggers",
  );
  const db = await miniflare.getD1Database("DB");
  const migration = [
    "0001_workspace.sql",
    "0002_submitted_files.sql",
    "0003_connectors.sql",
    "0004_simplification.sql",
  ]
    .map((name) =>
      readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"),
    )
    .join("\n");
  await db.exec(migration.replace(/--[^\n]*/g, "").replace(/\n/g, " "));

  const session = await request("/api/session");
  assert.equal(session.status, 200);
  const owner = session.value.user.id;
  const emptyGoals = await request("/api/goals");
  assert.equal(emptyGoals.status, 200);
  assert.deepEqual(
    emptyGoals.value.goals,
    [],
    "A real account starts without seeded goals",
  );
  const goalInput = {
    title: "Runtime curriculum goal",
    targetDate: "2030-12-31",
    measure: "curriculum",
    scope: "all",
    target: 10,
    unit: "tasks",
  };
  const goalHeaders = { "Idempotency-Key": "runtime-goal-create-v1" };
  const createdGoal = await request(
    "/api/goals",
    "POST",
    goalInput,
    goalHeaders,
  );
  assert.equal(createdGoal.status, 201);
  const goalId = createdGoal.value.goal.id;
  const repeatedGoal = await request(
    "/api/goals",
    "POST",
    goalInput,
    goalHeaders,
  );
  assert.equal(repeatedGoal.status, 200);
  assert.equal(
    repeatedGoal.value.goal.id,
    goalId,
    "A retried goal create must not duplicate it",
  );
  assert.equal(
    (
      await request(
        "/api/goals",
        "POST",
        { ...goalInput, title: "Different input" },
        goalHeaders,
      )
    ).status,
    409,
  );
  const checkpoint = {
    value: 3,
    at: new Date(Date.now() - 1000).toISOString(),
  };
  const checkedGoal = await request(
    `/api/goals/${goalId}/checkpoint`,
    "POST",
    checkpoint,
  );
  assert.equal(checkedGoal.status, 200);
  assert.equal(checkedGoal.value.goal.version, 2);
  assert.equal(checkedGoal.value.goal.value, 3);
  assert.equal(checkedGoal.value.goal.checkpoints.length, 1);
  const repeatedCheckpoint = await request(
    `/api/goals/${goalId}/checkpoint`,
    "POST",
    checkpoint,
  );
  assert.equal(repeatedCheckpoint.status, 200);
  assert.equal(repeatedCheckpoint.value.goal.version, 2);
  assert.equal(repeatedCheckpoint.value.goal.checkpoints.length, 1);

  const foreignOwner = "runtime-foreign-owner";
  const foreignId = "22222222-2222-4222-8222-222222222222";
  await db
    .prepare(
      "INSERT INTO user(id,name,email,email_verified,created_at,updated_at,github_id,github_login) VALUES(?,?,?,?,?,?,?,?)",
    )
    .bind(
      foreignOwner,
      "Other",
      "other@example.invalid",
      1,
      Date.now(),
      Date.now(),
      "foreign-id",
      "foreign-login",
    )
    .run();
  const foreignGoal = {
    ...checkedGoal.value.goal,
    id: foreignId,
    title: "Foreign private goal",
  };
  await db
    .prepare(
      "INSERT INTO goals(id,owner_id,payload,version,created_at,updated_at,deleted_at) VALUES(?,?,?,?,?,?,NULL)",
    )
    .bind(
      foreignId,
      foreignOwner,
      JSON.stringify(foreignGoal),
      foreignGoal.version,
      foreignGoal.createdAt,
      foreignGoal.updatedAt,
    )
    .run();
  assert.deepEqual(
    (
      await request("/api/goals?owner_id=runtime-foreign-owner")
    ).value.goals.map((goal) => goal.id),
    [goalId],
  );
  assert.equal(
    (await request(`/api/goals/${foreignId}/checkpoint`, "POST", checkpoint))
      .status,
    404,
  );
  assert.equal(
    (await request(`/api/goals/${foreignId}`, "DELETE")).status,
    404,
  );
  const backup = await request("/api/export?files=false");
  assert.equal(backup.status, 200);
  assert.equal(backup.value.format, "work-export");
  assert.equal(backup.value.version, 2);
  assert.deepEqual(
    backup.value.goals.map((goal) => goal.id),
    [goalId],
  );
  assert.equal(backup.value.goals[0].checkpoints.length, 1);
  const restored = await request("/api/restore", "POST", backup.value);
  assert.equal(restored.status, 201);
  assert.equal(restored.value.goals.length, 1);
  assert.notEqual(restored.value.goals[0].id, goalId);
  assert.equal(restored.value.goals[0].value, 3);
  const restoredAgain = await request("/api/restore", "POST", backup.value);
  assert.equal(restoredAgain.status, 201);
  assert.equal(restoredAgain.value.goals[0].id, restored.value.goals[0].id);
  assert.equal((await request("/api/goals")).value.goals.length, 2);
  const legacyReport = await request("/api/goals/legacy");
  assert.equal(legacyReport.status, 200);
  assert.equal(Array.isArray(legacyReport.value.entries), true);

  const unconfiguredStats = await request("/api/learning/stats");
  assert.equal(unconfiguredStats.status, 200);
  assert.equal(unconfiguredStats.value.configured, false);
  assert.equal(unconfiguredStats.value.data, null);
  const preferences = (await request("/api/preferences")).value.preferences;
  assert.equal(
    (
      await request("/api/preferences", "PUT", {
        ...preferences,
        leetcode: "https://leetcode.com/u/runtime-solver/",
      })
    ).status,
    200,
  );
  const fetchedAt = new Date().toISOString();
  await db
    .prepare(
      "INSERT INTO learning_source_cache(owner_id,source_key,payload,fetched_at) VALUES(?,?,?,?)",
    )
    .bind(owner, "content", JSON.stringify(learningContent), fetchedAt)
    .run();
  const beforeCachedRead = requests.length;
  const cachedContent = await request("/api/learning/content");
  assert.equal(cachedContent.status, 200);
  assert.deepEqual(cachedContent.value.data, learningContent);
  assert.equal(cachedContent.value.source.stale, false);
  assert.equal(cachedContent.value.source.fetchedAt, fetchedAt);
  assert.equal(
    requests.length,
    beforeCachedRead,
    "Fresh source cache must not make upstream calls",
  );
  const sourceStats = await request(
    "/api/learning/stats?username=another-user",
  );
  assert.equal(
    sourceStats.status,
    200,
    JSON.stringify({ response: sourceStats.value, outbound: requests }),
  );
  assert.equal(sourceStats.value.username, "runtime-solver");
  assert.deepEqual(sourceStats.value.data.solvedDays, learningStats.solvedDays);
  assert.equal((await request("/api/learning/progress")).status, 200);
  const sharedTask = await request("/api/learning/progress", "POST", {
    taskId: "runtime-task",
    done: true,
  });
  assert.equal(sharedTask.status, 200);
  assert.deepEqual(sharedTask.value.data.tasks, { "runtime-task": true });
  assert.equal(
    (
      await request("/api/learning/progress", "POST", {
        taskId: "private-career-goal",
        done: true,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request("/api/learning/progress", "POST", {
        taskId: "runtime-task",
        done: "true",
      })
    ).status,
    400,
  );
  const beforeTaskRead = requests.length;
  assert.deepEqual((await request("/api/learning/progress")).value.data.tasks, {
    "runtime-task": true,
  });
  assert.equal(requests.length, beforeTaskRead);
  await db
    .prepare(
      "UPDATE learning_source_cache SET fetched_at=? WHERE owner_id=? AND source_key='content'",
    )
    .bind("2000-01-01T00:00:00.000Z", owner)
    .run();
  learningResponse = "unavailable";
  const cachedOutage = await request("/api/learning/content");
  assert.equal(cachedOutage.status, 200);
  assert.equal(cachedOutage.value.source.stale, true);
  assert.deepEqual(cachedOutage.value.data, learningContent);
  learningResponse = "malformed";
  const cachedMalformed = await request("/api/learning/content");
  assert.equal(cachedMalformed.status, 200);
  assert.equal(cachedMalformed.value.source.stale, true);
  assert.deepEqual(cachedMalformed.value.data, learningContent);
  learningResponse = "valid";
  const refreshedContent = await request("/api/learning/content");
  assert.equal(refreshedContent.status, 200);
  assert.equal(refreshedContent.value.source.stale, false);
  assert.deepEqual(refreshedContent.value.data, learningContent);
  for (const provider of ["github", "notion"]) {
    const webhook = await miniflare.dispatchFetch(
      `https://work.example/api/connectors/webhooks/${provider}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
    );
    assert.equal(
      webhook.status,
      410,
      "Retired webhook routes must reject deliveries on a production hostname",
    );
  }
  assert.equal((await request("/api/connectors/suggestions")).status, 404);
  assert.equal(
    (
      await request(
        "/api/connectors/suggestions/runtime-suggestion/accept",
        "POST",
        {},
      )
    ).status,
    404,
  );

  const connected = await request("/api/connectors/notion/connect", "POST", {
    token,
  });
  assert.equal(
    connected.status,
    201,
    "Notion token connection must work inside Workers",
  );
  assert.equal(connected.value.connection.accountId, "synthetic-workspace");
  const stored = await db
    .prepare(
      "SELECT credential FROM connector_connections WHERE provider='notion'",
    )
    .first();
  assert.match(stored.credential, /^v1\./);
  assert.equal(stored.credential.includes(token), false);

  const discovery = await request("/api/connectors/notion/discover");
  assert.equal(discovery.status, 200);
  assert.equal(discovery.value.items[0].id, pageId);
  const selected = await request("/api/connectors/notion/selection", "PUT", {
    selections: discovery.value.items,
  });
  assert.equal(selected.status, 200);
  assert.equal(
    selected.value.connection.status,
    "connected",
    JSON.stringify(selected.value),
  );

  const github = await request("/api/connectors/github/connect", "POST", {
    username: "runtime-owner",
  });
  assert.equal(github.status, 201);
  assert.equal((await request("/api/connectors/github/discover")).status, 200);
  const leetcode = await request("/api/connectors/leetcode/connect", "POST", {
    username: "runtime-solver",
  });
  assert.equal(leetcode.status, 201);
  assert.equal(leetcode.value.connection.status, "connected");

  notionResponse = "invalid";
  const invalid = await request("/api/connectors/notion/connect", "POST", {
    token,
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.value.error.code, "NOTION_ACCESS_FAILED");
  notionResponse = "redirect";
  assert.equal(
    (await request("/api/connectors/notion/connect", "POST", { token })).status,
    502,
  );
  assert.equal(
    requests.some((url) => url.includes("unexpected.example")),
    false,
    "Never follow credential-bearing redirects",
  );
  notionResponse = "malformed";
  assert.equal(
    (await request("/api/connectors/notion/connect", "POST", { token })).status,
    502,
  );
  notionResponse = "unavailable";
  assert.equal(
    (await request("/api/connectors/notion/connect", "POST", { token })).status,
    502,
  );
  assert.equal(
    (
      await db
        .prepare(
          "SELECT credential FROM connector_connections WHERE provider='notion'",
        )
        .first()
    ).credential,
    stored.credential,
    "Failed reconnects must preserve the working connection",
  );
  console.log(
    "Built Worker checks passed: goals/checkpoints/ownership/idempotency, v2 backup restore, cached Learn/shared tasks/source failures, retired webhooks/suggestions/jobs, legacy provider recovery.",
  );
} finally {
  await miniflare.dispose();
}
