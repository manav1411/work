import {
  recordSource,
  type ConnectorConnection,
  type ConnectorSelection,
} from "../../shared/connectors";
import { newRecord, writeRecord, type AttachmentRow } from "../db/records";
import { prepareAttachment, insertAttachment } from "../files";
import { ApiError, id, now, type Env } from "../env";
import { hashValue, readLimitedBody } from "../validation";
import {
  openCredentials,
  installationToken,
  sealCredentials,
} from "./credentials";
import {
  connection,
  leaseGuard,
  mappedRecord,
  publicConnection,
  sourceVisibility,
  type ConnectionRow,
  type SourceRow,
} from "./store";
import {
  fetchLeetCode,
  fetchGitHubRepository,
  fetchNotionPage,
  ProviderFailure,
} from "./providers";

const cadence = {
  notion: 30 * 60_000,
  github: 60 * 60_000,
  leetcode: 4 * 60 * 60_000,
  overleaf: 0,
};
interface SyncCursor {
  index?: number;
  selections?: ConnectorSelection[];
}
type SourceResult =
  | Awaited<ReturnType<typeof fetchNotionPage>>
  | Awaited<ReturnType<typeof fetchGitHubRepository>>;

export async function providerToken(
  env: Env,
  row: ConnectionRow,
): Promise<string | undefined> {
  const credentials = await openCredentials(env, row.id, row.credential);
  if (row.provider === "github" && credentials.installationId)
    return installationToken(env, credentials.installationId);
  return credentials.token;
}
async function refreshNotionToken(
  env: Env,
  row: ConnectionRow,
): Promise<string | null> {
  const credentials = await openCredentials(env, row.id, row.credential);
  if (
    !credentials.refreshToken ||
    !env.NOTION_CLIENT_ID ||
    !env.NOTION_CLIENT_SECRET
  )
    return null;
  const response = await fetch("https://api.notion.com/v1/oauth/token", {
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: `Basic ${btoa(`${env.NOTION_CLIENT_ID}:${env.NOTION_CLIENT_SECRET}`)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: credentials.refreshToken,
    }),
  });
  if (!response.ok) return null;
  const data = (await response.json()) as Record<string, unknown>;
  if (
    typeof data.access_token !== "string" ||
    typeof data.refresh_token !== "string"
  )
    return null;
  const sealed = await sealCredentials(env, row.id, {
    token: data.access_token,
    refreshToken: data.refresh_token,
  });
  await env.DB.prepare(
    "UPDATE connector_connections SET credential=? WHERE id=? AND owner_id=? AND generation=?",
  )
    .bind(sealed, row.id, row.owner_id, row.generation)
    .run();
  row.credential = sealed;
  return data.access_token;
}
function mediaKey(url: string): string {
  const parsed = new URL(url);
  return `${parsed.hostname}${parsed.pathname}`;
}
function permittedMedia(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      !parsed.username &&
      !parsed.password &&
      (parsed.hostname === "prod-files-secure.s3.us-west-2.amazonaws.com" ||
        (parsed.hostname === "s3.us-west-2.amazonaws.com" &&
          parsed.pathname.startsWith("/secure.notion-static.com/")) ||
        parsed.hostname === "secure.notion-static.com" ||
        parsed.hostname === "file.notion.so" ||
        parsed.hostname.endsWith(".notionusercontent.com"))
    );
  } catch {
    return false;
  }
}
async function copyMedia(
  env: Env,
  owner: string,
  recordId: string,
  result: SourceResult,
  prior: SourceRow | null,
) {
  let body = result.body;
  const stored: Record<string, string> = prior ? JSON.parse(prior.media) : {};
  const created: AttachmentRow[] = [];
  const warnings: string[] = [];
  const media = "media" in result ? result.media : [];
  try {
    for (const item of media.slice(0, 8)) {
      if (!permittedMedia(item.url)) {
        warnings.push(
          "An external attachment remains available through its source link.",
        );
        continue;
      }
      const key = mediaKey(item.url);
      let attachmentId = stored[key];
      if (attachmentId) {
        const existing = await env.DB.prepare(
          "SELECT id FROM attachments WHERE id=? AND owner_id=? AND record_id=?",
        )
          .bind(attachmentId, owner, recordId)
          .first();
        if (!existing) attachmentId = "";
      }
      if (!attachmentId) {
        const response = await fetch(item.url, {
          redirect: "manual",
          signal: AbortSignal.timeout(12_000),
        });
        if (!response.ok)
          throw new ProviderFailure(
            "A Notion attachment could not be retrieved. Refresh to try again.",
            502,
          );
        const contentType =
          response.headers.get("Content-Type")?.split(";")[0].trim() ||
          "application/octet-stream";
        const bytes = await readLimitedBody(response, 10 * 1024 * 1024);
        const prepared = await prepareAttachment(
          env,
          owner,
          recordId,
          item.filename,
          contentType,
          bytes,
        );
        created.push(prepared);
        attachmentId = prepared.id;
        stored[key] = attachmentId;
      }
      body = body.split(item.url).join(`/api/attachments/${attachmentId}`);
    }
    if (media.length > 8)
      warnings.push(
        "Additional attachments can be opened in Notion; this update copied the first eight.",
      );
    return { body, stored, created, warnings };
  } catch (error) {
    for (const file of created) await env.FILES.delete(file.object_key);
    throw error;
  }
}
async function hideSource(
  env: Env,
  row: ConnectionRow,
  sourceId: string,
  lease: string,
) {
  const source = await env.DB.prepare(
    "SELECT * FROM connector_sources WHERE owner_id=? AND provider=? AND account_id=? AND source_id=?",
  )
    .bind(row.owner_id, row.provider, row.account_id, sourceId)
    .first<SourceRow>();
  if (!source) return;
  const before = source.record_id
    ? await mappedRecord(env.DB, row.owner_id, source.record_id)
    : null;
  const statements = [
    env.DB.prepare(
      "UPDATE connector_sources SET available=0 WHERE id=? AND owner_id=?",
    ).bind(source.id, row.owner_id),
    ...leaseGuard(env, row, lease),
  ];
  if (before && !before.deletedAt) {
    const metadata = recordSource(before);
    if (metadata?.available)
      await writeRecord(
        env.DB,
        row.owner_id,
        {
          ...before,
          data: {
            ...before.data,
            connectorSource: { ...metadata, available: false },
          },
          version: before.version + 1,
          updatedAt: now(),
        },
        before.version,
        statements,
      );
    else await env.DB.batch(statements);
  } else await env.DB.batch(statements);
}
async function mapSource(
  env: Env,
  row: ConnectionRow,
  selection: ConnectorSelection,
  result: SourceResult,
  lease: string,
  cursor: SyncCursor,
): Promise<boolean> {
  const source = await env.DB.prepare(
    "SELECT * FROM connector_sources WHERE owner_id=? AND provider=? AND account_id=? AND source_id=?",
  )
    .bind(row.owner_id, row.provider, row.account_id, result.sourceId)
    .first<SourceRow>();
  // A deleted record is not recreated by a scheduled update.
  if (source && !source.record_id && !selection.recordId) return false;
  const targetId = selection.recordId || source?.record_id;
  const before = targetId
    ? await mappedRecord(env.DB, row.owner_id, targetId)
    : null;
  if (targetId && (!before || before.deletedAt)) return false;
  const recordId = before?.id || id();
  const copied = await copyMedia(env, row.owner_id, recordId, result, source);
  const providerData =
    row.provider === "github"
      ? {
          sourceName: result.title,
          sourceDescription: result.data.sourceDescription,
          sourceReadme: result.body.slice(0, 50_000),
          sourceTopics: result.data.topics,
          sourceArchived: result.data.archived,
          sourceDefaultBranch: result.data.defaultBranch,
          sourceLanguage: result.data.technologies,
          sourceRepoUrl: result.url,
        }
      : {
          sourceWarnings: [
            ...(Array.isArray(result.data.warnings)
              ? result.data.warnings
              : []),
            ...copied.warnings,
          ],
        };
  const normalized = {
    title: result.title,
    body: copied.body,
    data: providerData,
    updatedAt: result.updatedAt,
    url: result.url,
  };
  const hash = await hashValue(normalized);
  const timestamp = now();
  const sourceId = source?.id || id();
  const metadata = {
    id: sourceId,
    provider: row.provider,
    url: result.url,
    lastFetchedAt: timestamp,
    sourceUpdatedAt: result.updatedAt,
    available: true,
  };
  const changed =
    !source ||
    source.content_hash !== hash ||
    !source.available ||
    !!recordSource(before || undefined)?.detached;
  const nativeData = before?.data || {};
  const record = before
    ? { ...before }
    : newRecord({
        kind: row.provider === "notion" ? "note" : "project",
        title: result.title.slice(0, 240),
        body: row.provider === "notion" ? copied.body : "",
        tags: [row.provider],
        data:
          row.provider === "github"
            ? {
                status: "Active",
                repoUrl: result.url,
                technologies: Array.isArray(result.data.technologies)
                  ? result.data.technologies.join(", ")
                  : "",
              }
            : { collection: "Notion" },
      });
  record.id = recordId;
  record.data = { ...record.data, ...providerData, connectorSource: metadata };
  if (row.provider === "notion") {
    record.title = result.title.slice(0, 240);
    record.body = copied.body;
    // Explicit linking keeps existing authored content as editable Work context.
    if (before && !recordSource(before) && before.body)
      record.data.annotation = [
        typeof nativeData.annotation === "string" ? nativeData.annotation : "",
        before.body,
      ]
        .filter(Boolean)
        .join("\n\n");
  }
  const extra: D1PreparedStatement[] = [
    ...copied.created.map((file) => insertAttachment(env.DB, file)),
    env.DB.prepare(
      "INSERT INTO connector_sources(id,owner_id,connection_id,provider,account_id,source_id,record_id,source_url,snapshot,content_hash,media,selected,available,last_fetched_at,source_updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,1,1,?,?) ON CONFLICT(owner_id,provider,account_id,source_id) DO UPDATE SET connection_id=excluded.connection_id,record_id=excluded.record_id,source_url=excluded.source_url,snapshot=excluded.snapshot,content_hash=excluded.content_hash,media=excluded.media,selected=1,available=1,last_fetched_at=excluded.last_fetched_at,source_updated_at=excluded.source_updated_at",
    ).bind(
      sourceId,
      row.owner_id,
      row.id,
      row.provider,
      row.account_id,
      result.sourceId,
      recordId,
      result.url,
      JSON.stringify(normalized),
      hash,
      JSON.stringify(copied.stored),
      timestamp,
      result.updatedAt,
    ),
    env.DB.prepare(
      "UPDATE connector_connections SET cursor=? WHERE id=? AND owner_id=? AND generation=? AND lease_token=?",
    ).bind(JSON.stringify(cursor), row.id, row.owner_id, row.generation, lease),
    ...leaseGuard(env, row, lease),
  ];
  if (
    row.provider === "github" &&
    source &&
    changed &&
    source.source_updated_at !== result.updatedAt
  )
    extra.push(
      env.DB.prepare(
        "INSERT OR IGNORE INTO connector_activity(id,owner_id,connection_id,provider,source_key,title,url,occurred_at,record_id) VALUES(?,?,?,?,?,?,?,?,?)",
      ).bind(
        id(),
        row.owner_id,
        row.id,
        row.provider,
        `${row.account_id}:${result.sourceId}:${result.updatedAt}`,
        result.title.slice(0, 240),
        result.url,
        result.updatedAt,
        recordId,
      ),
    );
  try {
    if (changed) {
      if (before) {
        record.version = before.version + 1;
        record.updatedAt = timestamp;
      }
      await writeRecord(env.DB, row.owner_id, record, before?.version, extra);
    } else await env.DB.batch(extra);
    return changed;
  } catch (error) {
    for (const file of copied.created) await env.FILES.delete(file.object_key);
    throw error;
  }
}
export async function syncConnection(
  env: Env,
  owner: string,
  provider: ConnectionRow["provider"],
  manual = false,
): Promise<{ connection: ConnectorConnection; message: string }> {
  const row = await connection(env.DB, owner, provider);
  if (row.status === "disconnected")
    throw new ApiError(
      409,
      "CONNECTION_DISCONNECTED",
      "Reconnect this source first.",
    );
  if (row.status === "paused")
    throw new ApiError(
      409,
      "CONNECTION_PAUSED",
      "Resume this source before refreshing.",
    );
  if (provider === "overleaf")
    return {
      connection: publicConnection(row),
      message: "The Overleaf source is linked. Upload a new PDF after editing.",
    };
  if (
    manual &&
    row.last_attempt_at &&
    Date.now() - Date.parse(row.last_attempt_at) < 60_000
  )
    throw new ApiError(
      429,
      "REFRESH_LIMIT",
      "An update was just requested. Try again in a minute.",
    );
  const lease = id();
  const acquired = await env.DB.prepare(
    "UPDATE connector_connections SET lease_token=?,lease_until=?,status='updating',last_attempt_at=? WHERE id=? AND owner_id=? AND generation=? AND (lease_until IS NULL OR lease_until<?) AND status NOT IN ('paused','disconnected') RETURNING id",
  )
    .bind(
      lease,
      new Date(Date.now() + 180_000).toISOString(),
      now(),
      row.id,
      owner,
      row.generation,
      now(),
    )
    .first();
  if (!acquired)
    throw new ApiError(
      409,
      "SYNC_IN_PROGRESS",
      "An update is already running.",
    );
  const runId = id();
  await env.DB.prepare(
    "INSERT INTO connector_runs(id,owner_id,connection_id,status,started_at) VALUES(?,?,?,'running',?)",
  )
    .bind(runId, owner, row.id, now())
    .run();
  let changed = 0;
  let unavailable = 0;
  let complete = true;
  try {
    let token = await providerToken(env, row);
    const config = JSON.parse(row.config) as ConnectorConnection["config"];
    if (provider === "leetcode") {
      const result = await fetchLeetCode(config.username || row.account_id);
      const activityResults = await env.DB.batch([
        ...result.activities.map((item) =>
          env.DB.prepare(
            "INSERT OR IGNORE INTO connector_activity(id,owner_id,connection_id,provider,source_key,title,url,occurred_at,problem_slug) VALUES(?,?,?,?,?,?,?,?,?)",
          ).bind(
            id(),
            owner,
            row.id,
            provider,
            `${row.account_id}:${item.sourceKey}`,
            item.title.slice(0, 240),
            item.url,
            item.occurredAt,
            item.problemSlug || null,
          ),
        ),
        env.DB.prepare(
          "UPDATE connector_connections SET snapshot=? WHERE id=? AND owner_id=? AND generation=? AND lease_token=?",
        ).bind(
          JSON.stringify({ ...result.snapshot, observedSince: row.created_at }),
          row.id,
          owner,
          row.generation,
          lease,
        ),
        ...leaseGuard(env, row, lease),
      ]);
      changed = activityResults
        .slice(0, result.activities.length)
        .reduce((sum, result) => sum + (result.meta.changes || 0), 0);
    } else {
      const cursor = JSON.parse(row.cursor) as SyncCursor;
      const selections = cursor.selections || [...(config.selections || [])];
      let index = cursor.index || 0;
      const stop = Math.min(index + 5, selections.length);
      for (; index < stop; index++) {
        const selection = selections[index];
        try {
          const fetchSource = () =>
            provider === "notion"
              ? fetchNotionPage(selection.id, token || "")
              : fetchGitHubRepository(selection.id, token);
          let result: SourceResult;
          try {
            result = await fetchSource();
          } catch (error) {
            if (
              provider === "notion" &&
              error instanceof ProviderFailure &&
              error.status === 401
            ) {
              const refreshed = await refreshNotionToken(env, row);
              if (!refreshed) throw error;
              token = refreshed;
              result = await fetchSource();
            } else throw error;
          }
          if (
            provider === "notion" &&
            config.includeDescendants &&
            "childPageIds" in result &&
            Array.isArray(result.childPageIds)
          ) {
            for (const childId of result.childPageIds as string[])
              if (
                !selections.some((item) => item.id === childId) &&
                selections.length < 100
              )
                selections.push({
                  id: childId,
                  title: "Notion child page",
                  url: `https://www.notion.so/${childId.replace(/-/g, "")}`,
                });
          }
          if (
            await mapSource(env, row, selection, result, lease, {
              index: index + 1,
              selections,
            })
          )
            changed++;
        } catch (error) {
          if (
            error instanceof ProviderFailure &&
            [403, 404].includes(error.status)
          ) {
            await hideSource(env, row, selection.id, lease);
            unavailable++;
            await env.DB.prepare(
              "UPDATE connector_connections SET cursor=? WHERE id=? AND generation=? AND lease_token=?",
            )
              .bind(
                JSON.stringify({ index: index + 1, selections }),
                row.id,
                row.generation,
                lease,
              )
              .run();
          } else throw error;
        }
      }
      complete = index >= selections.length;
      // Keep discovered descendants selected for reconciliation and removal.
      if (complete && selections.length !== (config.selections || []).length) {
        await env.DB.prepare(
          "UPDATE connector_connections SET config=? WHERE id=? AND owner_id=? AND generation=? AND lease_token=?",
        )
          .bind(
            JSON.stringify({ ...config, selections }),
            row.id,
            owner,
            row.generation,
            lease,
          )
          .run();
      }
    }
    const message = unavailable
      ? `${changed} updated; ${unavailable} sources are unavailable. Check source access.`
      : provider === "leetcode"
        ? "Public progress updated. Recent accepted submissions have been recorded."
        : `${changed} ${provider === "notion" ? "notes" : "projects"} updated${complete ? "." : "; the import will continue in the background."}`;
    await env.DB.batch([
      ...leaseGuard(env, row, lease),
      env.DB.prepare(
        "UPDATE connector_connections SET status=?,last_success_at=?,next_sync_at=?,error=?,cursor=?,lease_token=NULL,lease_until=NULL WHERE id=? AND owner_id=? AND generation=? AND lease_token=?",
      ).bind(
        unavailable ? "attention" : complete ? "connected" : "setting_up",
        now(),
        new Date(
          Date.now() + (complete ? cadence[provider] : 60_000),
        ).toISOString(),
        unavailable
          ? "Some selected sources are unavailable. Check access and refresh."
          : null,
        complete ? "{}" : (await connection(env.DB, owner, provider)).cursor,
        row.id,
        owner,
        row.generation,
        lease,
      ),
      env.DB.prepare(
        "UPDATE connector_runs SET status='success',message=?,changed=?,finished_at=? WHERE id=? AND owner_id=?",
      ).bind(message, changed, now(), runId, owner),
    ]);
    return {
      connection: publicConnection(await connection(env.DB, owner, provider)),
      message,
    };
  } catch (error) {
    const accessLost =
      (error instanceof ProviderFailure && [401, 403].includes(error.status)) ||
      (error instanceof ApiError && error.code === "GITHUB_ACCESS_FAILED");
    if (accessLost) {
      const current = await connection(env.DB, owner, provider);
      if (
        current.generation === row.generation &&
        current.lease_token === lease
      )
        await sourceVisibility(env, row, false, lease);
    }
    const message = accessLost
      ? "Access to this source changed. Reconnect to restore access."
      : error instanceof ProviderFailure
        ? error.message
        : "This update could not finish. Your last successful data is preserved. Try again.";
    const retry =
      error instanceof ProviderFailure
        ? error.retryAfterSeconds * 1000
        : 300_000;
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE connector_connections SET status='attention',error=?,next_sync_at=?,lease_token=NULL,lease_until=NULL WHERE id=? AND owner_id=? AND generation=? AND lease_token=?",
      ).bind(
        message,
        new Date(Date.now() + retry).toISOString(),
        row.id,
        owner,
        row.generation,
        lease,
      ),
      env.DB.prepare(
        "UPDATE connector_runs SET status='failed',message=?,changed=?,finished_at=? WHERE id=? AND owner_id=?",
      ).bind(message, changed, now(), runId, owner),
    ]);
    return {
      connection: publicConnection(await connection(env.DB, owner, provider)),
      message,
    };
  }
}
export async function scheduledSync(env: Env) {
  const due = await env.DB.prepare(
    "SELECT owner_id,provider FROM connector_connections WHERE provider!='overleaf' AND status NOT IN ('paused','disconnected') AND next_sync_at<=? AND (lease_until IS NULL OR lease_until<?) ORDER BY next_sync_at LIMIT 8",
  )
    .bind(now(), now())
    .all<{ owner_id: string; provider: ConnectionRow["provider"] }>();
  for (const row of due.results) {
    try {
      await syncConnection(env, row.owner_id, row.provider);
    } catch {
      /* another refresh may have claimed the lease */
    }
  }
}
