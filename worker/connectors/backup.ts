import { z } from "zod";
import { CONNECTOR_PROVIDERS } from "../../shared/connectors";
import { ApiError, id, type Env } from "../env";
import { connections, type SourceRow, type ActivityRow } from "./store";

const text = z.string().max(2048);
const identifier = z.string().min(1).max(200);
const json = z
  .record(z.string(), z.unknown())
  .refine((value) => JSON.stringify(value).length <= 100_000);
const configuration = z
  .object({
    username: text.optional(),
    projectUrl: text.optional(),
    assetId: identifier.optional(),
    selections: z
      .array(
        z
          .object({
            id: identifier,
            title: z.string().max(240),
            url: text,
            recordId: identifier.optional(),
          })
          .strict(),
      )
      .max(100)
      .optional(),
    includeDescendants: z.boolean().optional(),
    mode: z.enum(["public", "installation", "internal", "oauth"]).optional(),
  })
  .strict();
export const connectorBackupSchema = z
  .object({
    connections: z
      .array(
        z
          .object({
            id: identifier,
            provider: z.enum(CONNECTOR_PROVIDERS),
            accountId: identifier,
            label: z.string().max(240),
            config: configuration,
            snapshot: json,
            createdAt: z.string().datetime(),
            lastSuccessAt: z.string().datetime().nullable(),
          })
          .strict(),
      )
      .max(4),
    sources: z
      .array(
        z
          .object({
            id: identifier,
            connectionId: identifier,
            sourceId: identifier,
            recordId: identifier.nullable(),
            sourceUrl: text,
            contentHash: z.string().max(200),
            media: z.record(z.string(), z.string()),
            selected: z.boolean(),
            available: z.boolean(),
            lastFetchedAt: z.string().datetime(),
            sourceUpdatedAt: z.string().datetime().nullable(),
          })
          .strict(),
      )
      .max(1000),
    activities: z
      .array(
        z
          .object({
            id: identifier,
            connectionId: identifier,
            provider: z.enum(CONNECTOR_PROVIDERS),
            sourceKey: z.string().max(500),
            title: z.string().max(240),
            url: text,
            occurredAt: z.string().datetime(),
            problemSlug: z.string().max(160).nullable(),
            recordId: identifier.nullable(),
            actionId: identifier.nullable(),
            dismissed: z.boolean(),
          })
          .strict(),
      )
      .max(10_000),
  })
  .strict();
export type ConnectorBackup = z.infer<typeof connectorBackupSchema>;
export async function exportConnectors(
  env: Env,
  owner: string,
): Promise<ConnectorBackup> {
  const [list, sources, activity] = await Promise.all([
    connections(env.DB, owner),
    env.DB.prepare(
      "SELECT * FROM connector_sources WHERE owner_id=? LIMIT 1001",
    )
      .bind(owner)
      .all<SourceRow>(),
    env.DB.prepare(
      "SELECT * FROM connector_activity WHERE owner_id=? ORDER BY occurred_at DESC LIMIT 10001",
    )
      .bind(owner)
      .all<ActivityRow>(),
  ]);
  if (sources.results.length > 1000 || activity.results.length > 10_000)
    throw new ApiError(
      413,
      "CONNECTOR_EXPORT_TOO_LARGE",
      "The connected history exceeds the bundled backup limit.",
    );
  return {
    connections: list.map((row) => ({
      id: row.id,
      provider: row.provider,
      accountId: row.accountId,
      label: row.label,
      config: row.config,
      snapshot: row.snapshot,
      createdAt: row.createdAt,
      lastSuccessAt: row.lastSuccessAt,
    })),
    sources: sources.results.map((row) => ({
      id: row.id,
      connectionId: row.connection_id,
      sourceId: row.source_id,
      recordId: row.record_id,
      sourceUrl: row.source_url,
      contentHash: row.content_hash,
      media: JSON.parse(row.media),
      selected: !!row.selected,
      available: !!row.available,
      lastFetchedAt: row.last_fetched_at,
      sourceUpdatedAt: row.source_updated_at,
    })),
    activities: activity.results.map((row) => ({
      id: row.id,
      connectionId: row.connection_id,
      provider: row.provider,
      sourceKey: row.source_key,
      title: row.title,
      url: row.url,
      occurredAt: row.occurred_at,
      problemSlug: row.problem_slug,
      recordId: row.record_id,
      actionId: row.action_id,
      dismissed: !!row.dismissed,
    })),
  };
}
export async function restoreConnectorStatements(
  env: Env,
  owner: string,
  backup: ConnectorBackup | undefined,
  recordIds: Map<string, string>,
  fileIds: Map<string, string>,
): Promise<D1PreparedStatement[]> {
  if (!backup) return [];
  if (
    new Set(backup.connections.map((item) => item.provider)).size !==
    backup.connections.length
  )
    throw new ApiError(
      400,
      "INVALID_BACKUP",
      "The backup contains duplicate connections.",
    );
  const statements: D1PreparedStatement[] = [];
  const selected = new Map<
    string,
    { id: string; provider: string; accountId: string; active: boolean }
  >();
  for (const row of backup.connections) {
    const existing = await env.DB.prepare(
      "SELECT id,status,account_id FROM connector_connections WHERE owner_id=? AND provider=?",
    )
      .bind(owner, row.provider)
      .first<{ id: string; status: string; account_id: string }>();
    const connectionId = existing?.id || id();
    const active = !!existing && existing.status !== "disconnected";
    selected.set(row.id, {
      id: connectionId,
      provider: row.provider,
      accountId: row.accountId,
      active,
    });
    if (active) continue;
    const config = {
      ...row.config,
      ...(row.config.assetId
        ? { assetId: recordIds.get(row.config.assetId) }
        : {}),
      selections: row.config.selections?.map((item) => ({
        ...item,
        ...(item.recordId ? { recordId: recordIds.get(item.recordId) } : {}),
      })),
    };
    statements.push(
      env.DB.prepare(
        "INSERT INTO connector_connections(id,owner_id,provider,account_id,label,status,config,snapshot,created_at,last_success_at) VALUES(?,?,?,?,?,'disconnected',?,?,?,?) ON CONFLICT(owner_id,provider) DO UPDATE SET config=excluded.config,snapshot=excluded.snapshot,credential=NULL,status='disconnected',account_id=excluded.account_id,label=excluded.label,generation=generation+1,next_sync_at=NULL,cursor='{}'",
      ).bind(
        connectionId,
        owner,
        row.provider,
        row.accountId,
        row.label,
        JSON.stringify(config),
        JSON.stringify(row.snapshot),
        row.createdAt,
        row.lastSuccessAt,
      ),
    );
  }
  const sourceRows: Record<string, unknown>[] = [];
  for (const row of backup.sources) {
    const parent = selected.get(row.connectionId);
    if (!parent)
      throw new ApiError(
        400,
        "INVALID_BACKUP",
        "A source references a missing connection.",
      );
    if (parent.active) continue;
    const recordId = row.recordId ? recordIds.get(row.recordId) : null;
    if (row.recordId && !recordId)
      throw new ApiError(
        400,
        "INVALID_BACKUP",
        "A connected source references a missing record.",
      );
    const restoredSourceId = id();
    sourceRows.push({
      id: restoredSourceId,
      connectionId: parent.id,
      provider: parent.provider,
      accountId: parent.accountId,
      sourceId: row.sourceId,
      recordId: recordId || null,
      sourceUrl: row.sourceUrl,
      contentHash: row.contentHash,
      media: Object.fromEntries(
        Object.entries(row.media).flatMap(([key, value]) =>
          fileIds.has(value) ? [[key, fileIds.get(value)!]] : [],
        ),
      ),
      selected: row.selected ? 1 : 0,
      available: row.available ? 1 : 0,
      lastFetchedAt: row.lastFetchedAt,
      sourceUpdatedAt: row.sourceUpdatedAt,
    });
  }
  if (sourceRows.length)
    statements.push(
      env.DB.prepare(
        "INSERT INTO connector_sources(id,owner_id,connection_id,provider,account_id,source_id,record_id,source_url,content_hash,media,selected,available,last_fetched_at,source_updated_at) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.connectionId'),json_extract(value,'$.provider'),json_extract(value,'$.accountId'),json_extract(value,'$.sourceId'),json_extract(value,'$.recordId'),json_extract(value,'$.sourceUrl'),json_extract(value,'$.contentHash'),json_extract(value,'$.media'),json_extract(value,'$.selected'),json_extract(value,'$.available'),json_extract(value,'$.lastFetchedAt'),json_extract(value,'$.sourceUpdatedAt') FROM json_each(?) WHERE true ON CONFLICT(owner_id,provider,account_id,source_id) DO NOTHING",
      ).bind(owner, JSON.stringify(sourceRows)),
    );
  const activityRows = backup.activities.flatMap((row) => {
    const parent = selected.get(row.connectionId);
    if (!parent)
      throw new ApiError(
        400,
        "INVALID_BACKUP",
        "Activity references a missing connection.",
      );
    if (parent.active) return [];
    return [
      {
        ...row,
        id: id(),
        connectionId: parent.id,
        recordId: row.recordId ? recordIds.get(row.recordId) || null : null,
        actionId: row.actionId ? recordIds.get(row.actionId) || null : null,
        dismissed: row.dismissed ? 1 : 0,
      },
    ];
  });
  if (activityRows.length)
    statements.push(
      env.DB.prepare(
        "INSERT INTO connector_activity(id,owner_id,connection_id,provider,source_key,title,url,occurred_at,problem_slug,record_id,action_id,dismissed) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.connectionId'),json_extract(value,'$.provider'),json_extract(value,'$.sourceKey'),json_extract(value,'$.title'),json_extract(value,'$.url'),json_extract(value,'$.occurredAt'),json_extract(value,'$.problemSlug'),json_extract(value,'$.recordId'),json_extract(value,'$.actionId'),json_extract(value,'$.dismissed') FROM json_each(?) WHERE true ON CONFLICT(owner_id,provider,source_key) DO NOTHING",
      ).bind(owner, JSON.stringify(activityRows)),
    );
  return statements;
}
export function detachRestoredSource(
  data: Record<string, unknown>,
): Record<string, unknown> {
  if (data.connectorSource && typeof data.connectorSource === "object")
    return {
      ...data,
      connectorSource: {
        ...data.connectorSource,
        detached: true,
        available: true,
      },
    };
  return data;
}
