import { Hono } from "hono";
import { z } from "zod";
import {
  CONNECTOR_PROVIDERS,
  recordSource,
  type ConnectorProvider,
  type ConnectorSelection,
} from "../../shared/connectors";
import { ApiError, now, type Env, type Variables } from "../env";
import { parse, readJson } from "../validation";
import {
  getRecord,
  newRecord,
  writeRecord,
  type AttachmentRow,
} from "../db/records";
import { prepareAttachment, insertAttachment } from "../files";
import {
  credentialsConfigured,
  githubAppConfigured,
  openCredentials,
  githubAppRequest,
  type ConnectorCredentials,
} from "./credentials";
import {
  authorize,
  callback,
  notionOAuthConfigured,
  saveConnection,
} from "./oauth";
import {
  connection,
  connections,
  publicConnection,
  assertIdle,
  detachSources,
  editConnection,
  runs,
  publicActivity,
  type ActivityRow,
} from "./store";
import {
  discoverGitHub,
  fetchGitHubProfile,
  fetchNotionBot,
  discoverNotion,
  ProviderFailure,
  normalizeLeetCodeUsername,
  normalizeNotionPageId,
} from "./providers";
import { providerToken, syncConnection } from "./sync";
import { beginNotionWebhook, readNotionVerification } from "./webhooks";

const routes = new Hono<{ Bindings: Env; Variables: Variables }>();
const providerSchema = z.enum(CONNECTOR_PROVIDERS);
const visibleActivity =
  "(a.provider!='github' OR EXISTS(SELECT 1 FROM connector_sources s WHERE s.owner_id=a.owner_id AND s.connection_id=a.connection_id AND s.account_id=c.account_id AND s.record_id=a.record_id AND s.selected=1 AND s.available=1)) AND (a.provider!='leetcode' OR substr(a.source_key,1,length(c.account_id)+1)=c.account_id||':')";
function provider(value: string): ConnectorProvider {
  return parse(providerSchema, value);
}
const connectSchema = z
  .object({
    username: z.string().trim().min(1).max(200).optional(),
    projectUrl: z.string().trim().min(1).max(2048).optional(),
    label: z.string().trim().max(120).optional(),
    token: z.string().trim().min(16).max(1000).optional(),
  })
  .strict();
const selectionSchema = z
  .object({
    selections: z
      .array(
        z
          .object({
            id: z.string().min(1).max(120),
            title: z.string().max(240),
            url: z.string().max(2048),
            recordId: z.string().min(1).max(120).optional(),
          })
          .strict(),
      )
      .max(100),
    includeDescendants: z.boolean().optional(),
    retention: z.enum(["keep", "remove"]).default("keep"),
  })
  .strict();
function githubUsername(value: string): string {
  let username = value.trim();
  if (username.startsWith("https://")) {
    const url = new URL(username);
    if (
      url.hostname !== "github.com" ||
      url.username ||
      url.password ||
      url.pathname.split("/").filter(Boolean).length !== 1
    )
      throw new ApiError(
        400,
        "INVALID_USERNAME",
        "Enter a GitHub username or profile URL.",
      );
    username = url.pathname.replace(/^\/|\/$/g, "");
  }
  if (!/^[a-z0-9](?:[a-z0-9-]{0,38})$/i.test(username))
    throw new ApiError(
      400,
      "INVALID_USERNAME",
      "Enter a valid GitHub username.",
    );
  return username;
}
routes.get("/", async (c) =>
  c.json({
    connections: await connections(c.env.DB, c.get("user").id),
    available: {
      notionOAuth: notionOAuthConfigured(c.env),
      notionToken: credentialsConfigured(c.env),
      githubApp: githubAppConfigured(c.env),
    },
  }),
);

routes.get("/activity", async (c) => {
  const owner = c.get("user").id;
  const selectedProvider = c.req.query("provider")
    ? provider(c.req.query("provider")!)
    : null;
  const limit = parse(
    z.coerce.number().int().min(1).max(100).default(30),
    c.req.query("limit"),
  );
  let cursor: { time: string; id: string } | null = null;
  if (c.req.query("cursor")) {
    try {
      cursor = JSON.parse(atob(c.req.query("cursor")!));
    } catch {
      throw new ApiError(
        400,
        "INVALID_CURSOR",
        "Choose a valid activity page.",
      );
    }
  }
  if (
    cursor &&
    (!z.string().datetime().safeParse(cursor.time).success ||
      typeof cursor.id !== "string")
  )
    throw new ApiError(400, "INVALID_CURSOR", "Choose a valid activity page.");
  const rows = await c.env.DB.prepare(
    `SELECT a.* FROM connector_activity a JOIN connector_connections c ON c.id=a.connection_id AND c.owner_id=a.owner_id WHERE a.owner_id=? AND c.status!='disconnected' AND NOT(c.status='attention' AND c.error LIKE 'Access%') AND ${visibleActivity} ${selectedProvider ? "AND a.provider=?" : ""} ${cursor ? "AND (a.occurred_at<? OR (a.occurred_at=? AND a.id<?))" : ""} ORDER BY a.occurred_at DESC,a.id DESC LIMIT ?`,
  )
    .bind(
      owner,
      ...(selectedProvider ? [selectedProvider] : []),
      ...(cursor ? [cursor.time, cursor.time, cursor.id] : []),
      limit + 1,
    )
    .all<ActivityRow>();
  const list = rows.results.slice(0, limit);
  const last = list.at(-1);
  return c.json({
    activities: list.map(publicActivity),
    cursor:
      rows.results.length > limit && last
        ? btoa(JSON.stringify({ time: last.occurred_at, id: last.id }))
        : null,
  });
});
// Suggestions are retired; source activity remains exportable.
routes.post("/:provider/connect", async (c) => {
  const owner = c.get("user").id;
  const target = provider(c.req.param("provider"));
  const input = parse(connectSchema, await readJson(c.req.raw));
  let row;
  if (target === "leetcode") {
    const username = normalizeLeetCodeUsername(
      input.username || input.projectUrl || "",
    );
    await saveConnection(
      c.env,
      owner,
      target,
      username.toLowerCase(),
      username,
      { username },
    );
    const result = await syncConnection(c.env, owner, target);
    return c.json(
      { connection: result.connection, message: result.message },
      201,
    );
  }
  if (target === "github") {
    const username = githubUsername(input.username || "");
    const profile = await fetchGitHubProfile(username);
    row = await saveConnection(
      c.env,
      owner,
      target,
      profile.id,
      profile.login,
      { username: profile.login, mode: "public", selections: [] },
    );
  } else if (target === "notion") {
    if (!input.token)
      throw new ApiError(
        400,
        "TOKEN_REQUIRED",
        "Connect through Notion or enter your selected-page connection token.",
      );
    if (!credentialsConfigured(c.env))
      throw new ApiError(
        503,
        "CONNECTORS_NOT_CONFIGURED",
        "Private connections are not configured yet.",
      );
    let result: Awaited<ReturnType<typeof fetchNotionBot>>;
    try {
      result = await fetchNotionBot(input.token);
    } catch (error) {
      if (error instanceof ProviderFailure && [401, 403].includes(error.status))
        throw new ApiError(
          400,
          "NOTION_ACCESS_FAILED",
          "Notion could not verify this token. Check the connection token in Notion and try again.",
        );
      throw error;
    }
    row = await saveConnection(
      c.env,
      owner,
      target,
      result.accountId,
      input.label || result.label,
      { mode: "internal", selections: [] },
      { token: input.token },
    );
  } else {
    throw new ApiError(
      400,
      "UNSUPPORTED_PROVIDER",
      "This connection is unavailable.",
    );
  }
  return c.json({ connection: publicConnection(row) }, 201);
});
routes.post("/:provider/authorize", async (c) => {
  const target = parse(z.enum(["notion", "github"]), c.req.param("provider"));
  return c.json({
    url: await authorize(c.env, c.get("user").id, target, c.req.raw),
  });
});
routes.get("/callback/:provider", async (c) => {
  const target = parse(z.enum(["notion", "github"]), c.req.param("provider"));
  try {
    await callback(c.env, c.get("user").id, target, c.req.raw);
    return c.redirect(`${c.env.APP_ORIGIN}/connectors?connected=${target}`);
  } catch (error) {
    if (error instanceof ApiError)
      return c.redirect(
        `${c.env.APP_ORIGIN}/connectors?error=${encodeURIComponent(error.message)}`,
      );
    throw error;
  }
});
routes.get("/:provider/discover", async (c) => {
  const target = provider(c.req.param("provider"));
  const row = await connection(c.env.DB, c.get("user").id, target);
  if (row.status === "disconnected")
    throw new ApiError(
      409,
      "CONNECTION_DISCONNECTED",
      "Reconnect this source first.",
    );
  const token = await providerToken(c.env, row);
  const cursor = c.req.query("cursor");
  if (target === "notion")
    return c.json(await discoverNotion(token || "", cursor));
  if (target === "github") {
    const config = JSON.parse(row.config) as { username?: string };
    return c.json(
      await discoverGitHub(config.username || row.label, token, cursor),
    );
  }
  throw new ApiError(
    400,
    "SELECTION_NOT_SUPPORTED",
    "This connection does not need a source selection.",
  );
});
routes.put("/:provider/selection", async (c) => {
  const target = parse(z.enum(["notion", "github"]), c.req.param("provider"));
  const owner = c.get("user").id;
  const row = await connection(c.env.DB, owner, target);
  assertIdle(row);
  if (row.status === "disconnected")
    throw new ApiError(
      409,
      "CONNECTION_DISCONNECTED",
      "Reconnect this source first.",
    );
  const input = parse(selectionSchema, await readJson(c.req.raw));
  const selected: ConnectorSelection[] = [];
  const recordIds = new Set<string>();
  const ids = new Set<string>();
  for (const item of input.selections) {
    const sourceId =
      target === "notion"
        ? normalizeNotionPageId(item.id)
        : parse(z.string().regex(/^[1-9]\d{0,19}$/), item.id);
    if (ids.has(sourceId))
      throw new ApiError(
        400,
        "DUPLICATE_SELECTION",
        "Choose each source once.",
      );
    ids.add(sourceId);
    const existing = await c.env.DB.prepare(
      "SELECT record_id FROM connector_sources WHERE owner_id=? AND provider=? AND account_id=? AND source_id=?",
    )
      .bind(owner, target, row.account_id, sourceId)
      .first<{ record_id: string | null }>();
    if (
      item.recordId &&
      existing?.record_id &&
      existing.record_id !== item.recordId
    )
      throw new ApiError(
        409,
        "SOURCE_ALREADY_LINKED",
        "This source already has a Work record. Keep its current mapping to preserve your context.",
      );
    if (item.recordId) {
      if (recordIds.has(item.recordId))
        throw new ApiError(
          400,
          "DUPLICATE_MAPPING",
          "A Work record can be linked to only one source.",
        );
      recordIds.add(item.recordId);
      const record = await getRecord(c.env.DB, owner, item.recordId);
      if (record.kind !== (target === "notion" ? "note" : "project"))
        throw new ApiError(
          400,
          "INVALID_MAPPING",
          "Choose a matching note or project from your workspace.",
        );
      const source = recordSource(record);
      if (source && !source.detached) {
        const mapped = await c.env.DB.prepare(
          "SELECT source_id FROM connector_sources WHERE record_id=? AND owner_id=? AND provider=? AND account_id=?",
        )
          .bind(record.id, owner, target, row.account_id)
          .first<{ source_id: string }>();
        if (mapped?.source_id !== sourceId)
          throw new ApiError(
            409,
            "SOURCE_ALREADY_LINKED",
            "This Work record is already linked to another source.",
          );
      }
    }
    selected.push({
      id: sourceId,
      title: item.title,
      url:
        target === "notion"
          ? `https://www.notion.so/${sourceId.replace(/-/g, "")}`
          : "https://github.com",
      ...(item.recordId ? { recordId: item.recordId } : {}),
    });
  }
  await editConnection(c.env, row, async (current) => {
    await detachSources(c.env, current, input.retention === "keep", ids);
    const config = {
      ...JSON.parse(current.config),
      selections: selected,
      includeDescendants: input.includeDescendants || false,
    };
    await c.env.DB.prepare(
      "UPDATE connector_connections SET config=?,generation=generation+1,cursor='{}',status='setting_up',next_sync_at=?,error=NULL WHERE id=? AND owner_id=?",
    )
      .bind(JSON.stringify(config), now(), row.id, owner)
      .run();
  });
  return c.json(await syncConnection(c.env, owner, target));
});
routes.post("/:provider/refresh", async (c) =>
  c.json(
    await syncConnection(
      c.env,
      c.get("user").id,
      provider(c.req.param("provider")),
      true,
    ),
  ),
);
routes.patch("/:provider", async (c) => {
  const target = provider(c.req.param("provider"));
  const owner = c.get("user").id;
  const row = await connection(c.env.DB, owner, target);
  assertIdle(row);
  const input = parse(
    z.object({ paused: z.boolean() }).strict(),
    await readJson(c.req.raw),
  );
  if (row.status === "disconnected")
    throw new ApiError(
      409,
      "CONNECTION_DISCONNECTED",
      "Reconnect this source first.",
    );
  await editConnection(c.env, row, async () => {
    await c.env.DB.prepare(
      "UPDATE connector_connections SET status=?,next_sync_at=?,generation=generation+1 WHERE id=? AND owner_id=?",
    )
      .bind(
        input.paused ? "paused" : "setting_up",
        input.paused ? null : now(),
        row.id,
        owner,
      )
      .run();
  });
  return c.json({
    connection: publicConnection(await connection(c.env.DB, owner, target)),
  });
});
routes.delete("/:provider", async (c) => {
  const target = provider(c.req.param("provider"));
  const owner = c.get("user").id;
  const row = await connection(c.env.DB, owner, target);
  assertIdle(row);
  const input = parse(
    z.object({ retention: z.enum(["keep", "remove"]) }).strict(),
    await readJson(c.req.raw),
  );
  // Key rotation must never prevent removal of local credentials.
  const credentials = await openCredentials(
    c.env,
    row.id,
    row.credential,
  ).catch((): ConnectorCredentials => ({}));
  await editConnection(c.env, row, async (current) => {
    await detachSources(c.env, current, input.retention === "keep");
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE connector_connections SET status='disconnected',credential=NULL,snapshot='{}',config='{}',generation=generation+1,cursor='{}',next_sync_at=NULL,error=NULL WHERE id=? AND owner_id=?",
      ).bind(row.id, owner),
      c.env.DB.prepare(
        "DELETE FROM connector_oauth_states WHERE owner_id=? AND provider=?",
      ).bind(owner, target),
      c.env.DB.prepare(
        "DELETE FROM connector_webhook_subscriptions WHERE owner_id=? AND connection_id=?",
      ).bind(owner, row.id),
      ...(input.retention === "remove"
        ? [
            c.env.DB.prepare(
              "DELETE FROM connector_activity WHERE owner_id=? AND connection_id=?",
            ).bind(owner, row.id),
          ]
        : []),
    ]);
  });
  let warning: string | undefined;
  if (row.credential && !Object.keys(credentials).length)
    warning =
      "Disconnected from Work. The saved credential could not be read; remove the Work connector in your provider settings to finish revoking access.";
  // Uninstall only this workspace's dedicated GitHub App, never the sign-in app.
  if (target === "github" && credentials.installationId) {
    try {
      await githubAppRequest(
        c.env,
        `/app/installations/${credentials.installationId}`,
        "DELETE",
      );
    } catch {
      warning =
        "Disconnected from Work. Remove the Work connector installation in GitHub to finish revoking provider access.";
    }
  }
  if (
    target === "notion" &&
    JSON.parse(row.config).mode === "oauth" &&
    "token" in credentials &&
    credentials.token
  ) {
    try {
      const response = await fetch("https://api.notion.com/v1/oauth/revoke", {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
        headers: {
          Authorization: `Basic ${btoa(`${c.env.NOTION_CLIENT_ID}:${c.env.NOTION_CLIENT_SECRET}`)}`,
          "Content-Type": "application/json",
          "Notion-Version": "2026-03-11",
        },
        body: JSON.stringify({ token: credentials.token }),
      });
      if (!response.ok) throw new Error("Revocation unavailable");
    } catch {
      warning =
        "Disconnected from Work. Remove the Work integration in Notion to finish revoking provider access.";
    }
  }
  return c.json({
    connection: publicConnection(await connection(c.env.DB, owner, target)),
    ...(warning ? { warning } : {}),
  });
});
routes.get("/:provider/runs", async (c) => {
  const row = await connection(
    c.env.DB,
    c.get("user").id,
    provider(c.req.param("provider")),
  );
  return c.json({ runs: await runs(c.env.DB, row.owner_id, row.id) });
});

routes.post("/notion/webhook-setup", async (c) =>
  c.json(await beginNotionWebhook(c.env, c.get("user").id), 201),
);
routes.get("/notion/webhook-setup/:id", async (c) =>
  c.json(
    await readNotionVerification(c.env, c.get("user").id, c.req.param("id")),
  ),
);

routes.post("/notion/copy", async (c) => {
  const owner = c.get("user").id;
  const input = parse(
    z.object({ recordId: z.string().min(1).max(120) }).strict(),
    await readJson(c.req.raw),
  );
  const before = await getRecord(c.env.DB, owner, input.recordId);
  const source = recordSource(before);
  if (before.kind !== "note" || source?.provider !== "notion")
    throw new ApiError(
      400,
      "INVALID_SOURCE",
      "Choose a connected Notion note.",
    );
  const record = newRecord({
    kind: "note",
    title: `${before.title} — Work copy`.slice(0, 240),
    body: before.body,
    tags: before.tags,
    links: before.links,
    data: {
      ...before.data,
      connectorSource: { ...source, detached: true, available: true },
    },
  });
  const files = await c.env.DB.prepare(
    "SELECT * FROM attachments WHERE record_id=? AND owner_id=?",
  )
    .bind(before.id, owner)
    .all<AttachmentRow>();
  const prepared: AttachmentRow[] = [];
  try {
    for (const file of files.results) {
      const object = await c.env.FILES.get(file.object_key);
      if (!object)
        throw new ApiError(
          409,
          "FILE_UNAVAILABLE",
          "An attachment is unavailable. Refresh the source before making a copy.",
        );
      const next = await prepareAttachment(
        c.env,
        owner,
        record.id,
        file.filename,
        file.content_type,
        new Uint8Array(await object.arrayBuffer()),
      );
      prepared.push(next);
      record.body = record.body
        .split(`work-attachment://${file.id}`)
        .join(`work-attachment://${next.id}`);
      record.body = record.body
        .split(`/api/attachments/${file.id}`)
        .join(`/api/attachments/${next.id}`);
      record.body = record.body
        .split(`work-attachment://${encodeURIComponent(file.filename)}`)
        .join(`work-attachment://${next.id}`);
    }
    await writeRecord(
      c.env.DB,
      owner,
      record,
      undefined,
      prepared.map((file) => insertAttachment(c.env.DB, file)),
    );
    return c.json({ record }, 201);
  } catch (error) {
    for (const file of prepared) await c.env.FILES.delete(file.object_key);
    throw error;
  }
});
export { routes as connectorRoutes };
