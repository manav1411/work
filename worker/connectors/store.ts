import type {
  ConnectorConnection,
  ConnectorProvider,
  ConnectorRun,
  ExternalActivity,
} from "../../shared/connectors";
import { recordSource } from "../../shared/connectors";
import { ApiError, id, now, type Env } from "../env";
import { fromRow, writeRecord, type RecordRow } from "../db/records";
import type { WorkRecord, RecordPatch } from "../../shared/model";
import { assertFilesNotSubmitted } from "../files";

export interface ConnectionRow {
  id: string;
  owner_id: string;
  provider: ConnectorProvider;
  account_id: string;
  label: string;
  status: ConnectorConnection["status"];
  config: string;
  snapshot: string;
  credential: string | null;
  generation: number;
  cursor: string;
  created_at: string;
  last_success_at: string | null;
  last_attempt_at: string | null;
  next_sync_at: string | null;
  error: string | null;
  lease_token: string | null;
  lease_until: string | null;
}
export interface SourceRow {
  id: string;
  owner_id: string;
  connection_id: string;
  provider: ConnectorProvider;
  account_id: string;
  source_id: string;
  record_id: string | null;
  source_url: string;
  snapshot: string;
  content_hash: string;
  media: string;
  selected: number;
  available: number;
  last_fetched_at: string;
  source_updated_at: string | null;
}
export interface ActivityRow {
  id: string;
  owner_id: string;
  connection_id: string;
  provider: ConnectorProvider;
  source_key: string;
  title: string;
  url: string;
  occurred_at: string;
  problem_slug: string | null;
  record_id: string | null;
  action_id: string | null;
  dismissed: number;
}
export const publicConnection = (row: ConnectionRow): ConnectorConnection => ({
  id: row.id,
  provider: row.provider,
  accountId: row.account_id,
  label: row.label,
  status: row.status,
  config: JSON.parse(row.config),
  snapshot: JSON.parse(row.snapshot),
  createdAt: row.created_at,
  lastSuccessAt: row.last_success_at,
  lastAttemptAt: row.last_attempt_at,
  nextSyncAt: row.next_sync_at,
  error: row.error,
});
export const publicActivity = (row: ActivityRow): ExternalActivity => ({
  id: row.id,
  provider: row.provider,
  sourceKey: row.source_key,
  title: row.title,
  url: row.url,
  occurredAt: row.occurred_at,
  ...(row.problem_slug ? { problemSlug: row.problem_slug } : {}),
  ...(row.record_id ? { recordId: row.record_id } : {}),
});
export async function connection(
  db: D1Database,
  owner: string,
  provider: ConnectorProvider,
): Promise<ConnectionRow> {
  const row = await db
    .prepare(
      "SELECT * FROM connector_connections WHERE owner_id=? AND provider=?",
    )
    .bind(owner, provider)
    .first<ConnectionRow>();
  if (!row)
    throw new ApiError(
      404,
      "CONNECTION_NOT_FOUND",
      "Connect this source first.",
    );
  return row;
}
export async function connections(
  db: D1Database,
  owner: string,
): Promise<ConnectorConnection[]> {
  const rows = await db
    .prepare(
      "SELECT * FROM connector_connections WHERE owner_id=? ORDER BY created_at",
    )
    .bind(owner)
    .all<ConnectionRow>();
  return rows.results.map(publicConnection);
}
export function assertIdle(row: ConnectionRow) {
  if (row.lease_until && row.lease_until > now())
    throw new ApiError(
      409,
      "SYNC_IN_PROGRESS",
      "An update is running. Try again when it finishes.",
    );
}
// Reserve the same lease used by syncs while changing connection configuration.
// A read-only busy check alone leaves a window for a scheduled sync to start.
export async function editConnection<T>(
  env: Env,
  row: ConnectionRow,
  edit: (current: ConnectionRow) => Promise<T>,
): Promise<T> {
  const token = id();
  const claimed = await env.DB.prepare(
    "UPDATE connector_connections SET lease_token=?,lease_until=? WHERE id=? AND owner_id=? AND generation=? AND (lease_until IS NULL OR lease_until<=?) RETURNING *",
  )
    .bind(
      token,
      new Date(Date.now() + 3 * 60_000).toISOString(),
      row.id,
      row.owner_id,
      row.generation,
      now(),
    )
    .first<ConnectionRow>();
  if (!claimed)
    throw new ApiError(
      409,
      "SYNC_IN_PROGRESS",
      "This connection changed or an update is running. Reload and try again.",
    );
  try {
    return await edit(claimed);
  } finally {
    await env.DB.prepare(
      "UPDATE connector_connections SET lease_token=NULL,lease_until=NULL WHERE id=? AND owner_id=? AND lease_token=?",
    )
      .bind(row.id, row.owner_id, token)
      .run();
  }
}
export function assertProviderPatch(before: WorkRecord, patch: RecordPatch) {
  const source = recordSource(before);
  if (!source || source.detached) {
    if (
      patch.data?.connectorSource &&
      JSON.stringify(patch.data.connectorSource) !==
        JSON.stringify(before.data.connectorSource)
    )
      throw new ApiError(
        400,
        "SOURCE_METADATA_PROTECTED",
        "Source details are managed by your connector.",
      );
    return;
  }
  if (
    source.provider === "notion" &&
    ((patch.title !== undefined && patch.title !== before.title) ||
      (patch.body !== undefined && patch.body !== before.body))
  )
    throw new ApiError(
      409,
      "SOURCE_CONTENT_READ_ONLY",
      "Edit this note in Notion, or make a Work copy first.",
    );
  if (patch.data) {
    const protectedKeys = [
      "connectorSource",
      "sourceName",
      "sourceDescription",
      "sourceReadme",
      "sourceTopics",
      "sourceArchived",
      "sourceDefaultBranch",
      "sourceLanguage",
      "sourceRepoUrl",
      "sourceWarnings",
    ];
    if (
      protectedKeys.some(
        (key) =>
          JSON.stringify(patch.data?.[key]) !==
          JSON.stringify(before.data[key]),
      )
    )
      throw new ApiError(
        409,
        "SOURCE_METADATA_PROTECTED",
        "Keep the source details while editing your Work context. Reload and try again.",
      );
  }
}
export function assertNativeInput(data: Record<string, unknown> | undefined) {
  if (
    data?.connectorSource &&
    typeof data.connectorSource === "object" &&
    !(data.connectorSource as { detached?: boolean }).detached
  )
    throw new ApiError(
      400,
      "SOURCE_METADATA_PROTECTED",
      "Connect a source to create synchronized records.",
    );
}
export async function mappedRecord(
  db: D1Database,
  owner: string,
  recordId: string,
): Promise<WorkRecord | null> {
  const row = await db
    .prepare("SELECT * FROM records WHERE id=? AND owner_id=?")
    .bind(recordId, owner)
    .first<RecordRow>();
  return row ? fromRow(row) : null;
}
export async function sourceVisibility(
  env: Env,
  row: ConnectionRow,
  available: boolean,
  lease?: string,
) {
  const sources = await env.DB.prepare(
    "SELECT * FROM connector_sources WHERE connection_id=? AND owner_id=? AND account_id=? AND selected=1",
  )
    .bind(row.id, row.owner_id, row.account_id)
    .all<SourceRow>();
  for (const source of sources.results) {
    if (!source.record_id) continue;
    const before = await mappedRecord(env.DB, row.owner_id, source.record_id);
    if (!before || before.deletedAt) continue;
    const metadata = recordSource(before);
    if (!metadata || metadata.detached || metadata.available === available)
      continue;
    await writeRecord(
      env.DB,
      row.owner_id,
      {
        ...before,
        data: { ...before.data, connectorSource: { ...metadata, available } },
        version: before.version + 1,
        updatedAt: now(),
      },
      before.version,
      lease ? leaseGuard(env, row, lease) : [],
    );
  }
  await env.DB.batch([
    ...(lease ? leaseGuard(env, row, lease) : []),
    env.DB.prepare(
      "UPDATE connector_sources SET available=? WHERE connection_id=? AND owner_id=? AND account_id=? AND selected=1",
    ).bind(available ? 1 : 0, row.id, row.owner_id, row.account_id),
  ]);
}
export async function detachSources(
  env: Env,
  row: ConnectionRow,
  keep: boolean,
  selectedIds?: Set<string>,
) {
  const sources = await env.DB.prepare(
    "SELECT * FROM connector_sources WHERE connection_id=? AND owner_id=? AND selected=1",
  )
    .bind(row.id, row.owner_id)
    .all<SourceRow>();
  if (!keep) {
    const fileIds = sources.results
      .filter((source) => !selectedIds?.has(source.source_id))
      .flatMap((source) =>
        Object.values(JSON.parse(source.media) as Record<string, string>),
      );
    await assertFilesNotSubmitted(env.DB, row.owner_id, fileIds);
  }
  for (const source of sources.results) {
    if (selectedIds?.has(source.source_id)) continue;
    if (source.record_id) {
      const before = await mappedRecord(env.DB, row.owner_id, source.record_id);
      if (before && (!before.deletedAt || !keep)) {
        const metadata = recordSource(before);
        // Retained source copies require an explicit user retention choice.
        // Removing a source clears provider text but keeps relationships and Work context.
        const data: Record<string, unknown> = {
          ...before.data,
          ...(metadata && keep
            ? {
                connectorSource: {
                  ...metadata,
                  detached: true,
                  available: true,
                },
              }
            : {}),
        };
        if (!keep)
          for (const key of Object.keys(data))
            if (
              (key.startsWith("source") && key !== "sourceDate") ||
              key === "originalMarkdown" ||
              key === "connectorSource"
            )
              delete data[key];
        await writeRecord(
          env.DB,
          row.owner_id,
          {
            ...before,
            title:
              !keep && before.kind === "note"
                ? "Removed Notion source"
                : before.title,
            body: keep || before.kind !== "note" ? before.body : "",
            data,
            version: before.version + 1,
            updatedAt: now(),
          },
          before.version,
        );
        if (!keep) {
          // Privacy removal also erases historical copies of provider content.
          await env.DB.prepare(
            "UPDATE record_revisions SET title=CASE WHEN ?='note' THEN 'Removed Notion source' ELSE title END,body=CASE WHEN ?='note' THEN '' ELSE body END,data=json_remove(data,'$.connectorSource','$.sourceReadme','$.sourceDescription','$.sourceName','$.sourceTopics','$.sourceArchived','$.sourceDefaultBranch','$.sourceLanguage','$.sourceRepoUrl','$.sourceWarnings','$.originalMarkdown') WHERE owner_id=? AND record_id=?",
          )
            .bind(before.kind, before.kind, row.owner_id, before.id)
            .run();
        }
      }
    }
    if (!keep) {
      const fileIds = Object.values(
        JSON.parse(source.media) as Record<string, string>,
      );
      for (const fileId of fileIds) {
        const file = await env.DB.prepare(
          "SELECT object_key FROM attachments WHERE id=? AND owner_id=?",
        )
          .bind(fileId, row.owner_id)
          .first<{ object_key: string }>();
        if (!file) continue;
        await env.DB.prepare(
          "DELETE FROM attachments WHERE id=? AND owner_id=?",
        )
          .bind(fileId, row.owner_id)
          .run();
        await env.FILES.delete(file.object_key);
      }
    }
    await env.DB.prepare(
      "UPDATE connector_sources SET selected=0,snapshot='{}',media='{}',content_hash='' WHERE id=? AND owner_id=?",
    )
      .bind(source.id, row.owner_id)
      .run();
  }
}
export async function runs(
  db: D1Database,
  owner: string,
  connectionId: string,
): Promise<ConnectorRun[]> {
  const rows = await db
    .prepare(
      "SELECT id,connection_id AS connectionId,status,message,changed,started_at AS startedAt,finished_at AS finishedAt FROM connector_runs WHERE owner_id=? AND connection_id=? ORDER BY started_at DESC LIMIT 30",
    )
    .bind(owner, connectionId)
    .all<ConnectorRun>();
  return rows.results;
}
export function leaseGuard(
  env: Env,
  row: ConnectionRow,
  lease: string,
): D1PreparedStatement[] {
  const guard = id();
  return [
    env.DB.prepare(
      "INSERT INTO write_guards(id,value) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM connector_connections WHERE id=? AND owner_id=? AND generation=? AND lease_token=? AND lease_until>?) THEN 1 ELSE 0 END",
    ).bind(guard, row.id, row.owner_id, row.generation, lease, now()),
    env.DB.prepare("DELETE FROM write_guards WHERE id=?").bind(guard),
  ];
}
