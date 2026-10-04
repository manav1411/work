import { Hono } from "hono";
import type { z } from "zod";
import {
  LEARNING_SOURCE,
  learningContentSchema,
  learningProgressSchema,
  learningStatsSchema,
  learningToggleSchema,
  learningUsername,
  type LearningSourceResponse,
} from "../shared/learning";
import { ApiError, type Env, type Variables } from "./env";
import { readJson } from "./validation";

const MAX_SOURCE_BYTES = 4_000_000;
const SOURCE_TIMEOUT_MS = 12_000;
interface CacheRow {
  payload: string;
  fetched_at: string;
}

async function cached<T>(
  env: Env,
  owner: string,
  key: string,
  schema: z.ZodType<T>,
) {
  const row = await env.DB.prepare(
    "SELECT payload,fetched_at FROM learning_source_cache WHERE owner_id=? AND source_key=?",
  )
    .bind(owner, key)
    .first<CacheRow>();
  if (!row) return null;
  try {
    const data = schema.parse(JSON.parse(row.payload));
    if (!Number.isFinite(Date.parse(row.fetched_at))) return null;
    return { data, fetchedAt: row.fetched_at };
  } catch {
    return null;
  }
}

async function remember<T>(
  env: Env,
  owner: string,
  key: string,
  data: T,
  fetchedAt: string,
) {
  await env.DB.prepare(
    "INSERT INTO learning_source_cache(owner_id,source_key,payload,fetched_at) VALUES(?,?,?,?) ON CONFLICT(owner_id,source_key) DO UPDATE SET payload=excluded.payload,fetched_at=excluded.fetched_at",
  )
    .bind(owner, key, JSON.stringify(data), fetchedAt)
    .run();
}

export async function fetchLearningSource<T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit = {},
): Promise<T> {
  // Paths are built only by this module, never from a client URL. Cookies and
  // private Work data are not forwarded to the public learning source.
  const allowed =
    /^\/api\/(?:admin\/content|leetcode\?username=[A-Za-z0-9_-]{1,40}|progress(?:\?username=[A-Za-z0-9_-]{1,40})?)$/;
  if (!allowed.test(path))
    throw new ApiError(400, "LEARNING_SOURCE", "Invalid learning source.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS);
  try {
    const response = await fetch(`${LEARNING_SOURCE}${path}`, {
      ...init,
      headers: init.body
        ? { "Content-Type": "application/json" }
        : { Accept: "application/json" },
      // Workerd rejects `redirect: "error"` before the request is sent. Manual
      // redirects let us inspect the response and reject them without
      // forwarding any credentials.
      redirect: "manual",
      signal: controller.signal,
    });
    if (response.status >= 300 && response.status < 400)
      throw new Error("Learning source redirected");
    if (!response.ok)
      throw new Error(`Learning source returned ${response.status}`);
    if (!response.headers.get("content-type")?.includes("application/json"))
      throw new Error("Learning source returned invalid data");
    if (Number(response.headers.get("content-length")) > MAX_SOURCE_BYTES)
      throw new Error("Learning source response is too large");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Learning source returned no data");
    const decoder = new TextDecoder();
    let bytes = 0;
    let serialized = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_SOURCE_BYTES) {
          await reader.cancel();
          throw new Error("Learning source response is too large");
        }
        serialized += decoder.decode(value, { stream: true });
      }
      serialized += decoder.decode();
    } finally {
      reader.releaseLock();
    }
    return schema.parse(JSON.parse(serialized));
  } finally {
    clearTimeout(timeout);
  }
}

async function source<T>(
  env: Env,
  owner: string,
  key: string,
  path: string,
  schema: z.ZodType<T>,
  ttl: number,
): Promise<LearningSourceResponse<T>> {
  const previous = await cached(env, owner, key, schema);
  if (previous && Date.now() - Date.parse(previous.fetchedAt) < ttl)
    return {
      data: previous.data,
      source: { fetchedAt: previous.fetchedAt, stale: false },
    };
  try {
    const data = await fetchLearningSource(path, schema);
    const fetchedAt = new Date().toISOString();
    await remember(env, owner, key, data, fetchedAt);
    return { data, source: { fetchedAt, stale: false } };
  } catch {
    const error = "The learning source is unavailable. Retry to refresh.";
    if (previous)
      return {
        data: previous.data,
        source: { fetchedAt: previous.fetchedAt, stale: true, error },
      };
    throw new ApiError(502, "LEARNING_UNAVAILABLE", error);
  }
}

async function configuredUsername(env: Env, owner: string): Promise<string> {
  const row = await env.DB.prepare(
    "SELECT data FROM preferences WHERE owner_id=?",
  )
    .bind(owner)
    .first<{ data: string }>();
  if (row) {
    try {
      const value = JSON.parse(row.data) as { leetcode?: unknown };
      if (typeof value.leetcode === "string" && value.leetcode.trim())
        return learningUsername(value.leetcode);
    } catch {
      /* Legacy invalid preferences do not expose another account. */
    }
  }
  const connection = await env.DB.prepare(
    "SELECT config,account_id FROM connector_connections WHERE owner_id=? AND provider='leetcode' AND status!='disconnected' LIMIT 1",
  )
    .bind(owner)
    .first<{ config: string; account_id: string }>();
  if (!connection) return "";
  try {
    const config = JSON.parse(connection.config) as { username?: unknown };
    return learningUsername(
      typeof config.username === "string"
        ? config.username
        : connection.account_id,
    );
  } catch {
    return "";
  }
}

export const learningRoutes = new Hono<{
  Bindings: Env;
  Variables: Variables;
}>();
learningRoutes.get("/content", async (context) =>
  context.json(
    await source(
      context.env,
      context.get("user").id,
      "content",
      "/api/admin/content",
      learningContentSchema,
      300_000,
    ),
  ),
);
learningRoutes.get("/stats", async (context) => {
  const owner = context.get("user").id;
  const username = await configuredUsername(context.env, owner);
  if (!username)
    return context.json({
      data: null,
      username: "",
      configured: false,
      source: { fetchedAt: null, stale: false },
    });
  const result = await source(
    context.env,
    owner,
    `stats:${username.toLowerCase()}`,
    `/api/leetcode?username=${username}`,
    learningStatsSchema.refine(
      (stats) => stats.username.toLowerCase() === username.toLowerCase(),
      "The learning source returned a different account.",
    ),
    120_000,
  );
  return context.json({ ...result, username, configured: true });
});
learningRoutes.get("/progress", async (context) => {
  const owner = context.get("user").id;
  const username = await configuredUsername(context.env, owner);
  if (!username)
    return context.json({
      data: { tasks: {} },
      username: "",
      configured: false,
      source: { fetchedAt: null, stale: false },
    });
  return context.json({
    ...(await source(
      context.env,
      owner,
      `progress:${username.toLowerCase()}`,
      `/api/progress?username=${username}`,
      learningProgressSchema,
      15_000,
    )),
    username,
    configured: true,
  });
});
learningRoutes.post("/progress", async (context) => {
  const parsed = learningToggleSchema.safeParse(
    await readJson(context.req.raw),
  );
  if (!parsed.success)
    throw new ApiError(
      400,
      "LEARNING_TASK",
      "Choose a valid learning task and completion state.",
    );
  const owner = context.get("user").id;
  const username = await configuredUsername(context.env, owner);
  if (!username)
    throw new ApiError(
      400,
      "LEARNING_USERNAME",
      "Set your LeetCode username in Settings first.",
    );
  const content = await source(
    context.env,
    owner,
    "content",
    "/api/admin/content",
    learningContentSchema,
    300_000,
  );
  if (
    !content.data.weeks.some((week) =>
      week.tasks?.some((task) => task.id === parsed.data.taskId),
    )
  )
    throw new ApiError(
      400,
      "LEARNING_TASK",
      "This task is not part of the learning curriculum.",
    );
  try {
    const data = await fetchLearningSource(
      "/api/progress",
      learningProgressSchema,
      {
        method: "POST",
        body: JSON.stringify({ username, ...parsed.data }),
      },
    );
    const fetchedAt = new Date().toISOString();
    await remember(
      context.env,
      owner,
      `progress:${username.toLowerCase()}`,
      data,
      fetchedAt,
    );
    return context.json({
      data,
      username,
      configured: true,
      source: { fetchedAt, stale: false },
    });
  } catch {
    throw new ApiError(
      502,
      "LEARNING_SAVE",
      "Task completion could not be confirmed. Retry to reload shared progress.",
    );
  }
});
