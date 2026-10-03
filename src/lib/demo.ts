import {
  DEFAULT_PREFERENCES,
  type Attachment,
  type RecordInput,
  type RecordRevision,
  type UserPreferences,
  type WorkRecord,
} from "../../shared/model";
import { DEMO_EXTRAS, STARTER_RECORDS } from "../content/starter";
import { ApiError, type ApiAdapter } from "./api";

interface DemoBatch {
  id: string;
  source: string;
  createdAt: string;
  undoneAt: string | null;
  created: number;
  updated: number;
  skipped: number;
  changes: { id: string; version: number; before: WorkRecord | null }[];
}
interface DemoState {
  records: WorkRecord[];
  preferences: UserPreferences;
  revisions: RecordRevision[];
  attachments: Attachment[];
  files: Record<string, string>;
  batches?: DemoBatch[];
  restored?: Record<
    string,
    { restored: number; attachments: number; warnings: string[] }
  >;
}
interface ImportItem {
  sourceId: string;
  hash: string;
  record: RecordInput;
  attachments?: { filename: string; contentType: string; base64: string }[];
}

export function makeRecord(input: RecordInput): WorkRecord {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    kind: input.kind,
    title: input.title,
    body: input.body ?? "",
    tags: input.tags ?? [],
    links: input.links ?? [],
    data: input.data ?? {},
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

export function createDemoStore() {
  const storageKey = "work-demo-v1";
  let state: DemoState;
  try {
    const stored = sessionStorage.getItem(storageKey);
    state = stored
      ? (JSON.parse(stored) as DemoState)
      : {
          records: [...STARTER_RECORDS, ...DEMO_EXTRAS].map(makeRecord),
          preferences: { ...DEFAULT_PREFERENCES },
          revisions: [],
          attachments: [],
          files: {},
        };
    if (!Array.isArray(state.records) || !state.preferences)
      throw new Error("Invalid demo");
  } catch {
    state = {
      records: [...STARTER_RECORDS, ...DEMO_EXTRAS].map(makeRecord),
      preferences: { ...DEFAULT_PREFERENCES },
      revisions: [],
      attachments: [],
      files: {},
    };
  }
  const persist = () => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      /* A full preview storage must not destroy the live workspace. */
    }
  };
  const record = (id: string) => {
    const found = state.records.find((item) => item.id === id);
    if (!found) throw new ApiError("Record not found.", 404);
    return found;
  };
  const urls = new Map<string, string>();
  const revisions = (previous: WorkRecord) => {
    state.revisions.push({
      id: crypto.randomUUID(),
      recordId: previous.id,
      version: previous.version,
      title: previous.title,
      body: previous.body,
      tags: previous.tags,
      links: previous.links,
      data: previous.data,
      createdAt: new Date().toISOString(),
    });
  };
  const parse = (init?: RequestInit): Record<string, unknown> =>
    typeof init?.body === "string"
      ? (JSON.parse(init.body) as Record<string, unknown>)
      : {};
  const adapter: ApiAdapter = async (path, init) => {
    const url = new URL(path, "https://demo.invalid");
    const method = init?.method ?? "GET";
    const body = parse(init);
    if (url.pathname === "/api/session")
      return {
        user: { id: "demo", name: "Manav", email: "Preview workspace" },
        local: false,
        configured: true,
      };
    if (url.pathname === "/api/preferences") {
      if (method === "PUT") {
        state.preferences = {
          ...state.preferences,
          ...body,
        } as UserPreferences;
        persist();
      }
      return { preferences: state.preferences };
    }
    if (url.pathname === "/api/records/batch") {
      const items = body.records as RecordInput[];
      const created = items.map(makeRecord);
      state.records.push(...created);
      persist();
      return { records: created };
    }
    if (url.pathname === "/api/records") {
      if (method === "POST") {
        const created = makeRecord(body as unknown as RecordInput);
        state.records.push(created);
        persist();
        return { record: created };
      }
      return {
        records: state.records.filter(
          (item) =>
            url.searchParams.get("includeDeleted") === "true" ||
            !item.deletedAt,
        ),
      };
    }
    if (url.pathname === "/api/search") {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      return {
        records: state.records.filter(
          (item) =>
            !item.deletedAt &&
            `${item.title} ${item.body} ${item.tags.join(" ")} ${JSON.stringify(item.data)}`
              .toLowerCase()
              .includes(q),
        ),
      };
    }
    const route = /^\/api\/records\/([^/]+)(?:\/(.*))?$/.exec(url.pathname);
    if (route) {
      const previous = record(route[1]);
      const sub = route[2];
      if (sub === "revisions")
        return {
          revisions: state.revisions
            .filter((item) => item.recordId === previous.id)
            .reverse(),
        };
      if (sub === "restore") {
        previous.deletedAt = null;
        previous.version++;
        persist();
        return { record: previous };
      }
      if (sub === "permanent") {
        state.records = state.records.filter((item) => item.id !== previous.id);
        state.revisions = state.revisions.filter(
          (item) => item.recordId !== previous.id,
        );
        state.attachments
          .filter((item) => item.recordId === previous.id)
          .forEach((item) => {
            delete state.files[item.id];
          });
        state.attachments = state.attachments.filter(
          (item) => item.recordId !== previous.id,
        );
        persist();
        return { success: true };
      }
      if (sub === "attachments") {
        if (method === "POST" && init?.body instanceof FormData) {
          const file = init.body.get("file");
          if (!(file instanceof File))
            throw new ApiError("Choose a file.", 400);
          if (file.size > 10 * 1024 * 1024)
            throw new ApiError("Choose a file smaller than 10 MB.", 413);
          const bytes = new Uint8Array(await file.arrayBuffer());
          let binary = "";
          bytes.forEach((byte) => {
            binary += String.fromCharCode(byte);
          });
          const created: Attachment = {
            id: crypto.randomUUID(),
            recordId: previous.id,
            filename: file.name,
            contentType: file.type || "application/octet-stream",
            size: file.size,
            createdAt: new Date().toISOString(),
          };
          state.attachments.push(created);
          state.files[created.id] = btoa(binary);
          persist();
          return { attachment: created };
        }
        return {
          attachments: state.attachments.filter(
            (item) => item.recordId === previous.id,
          ),
        };
      }
      if (method === "PATCH") {
        if (body.version !== previous.version)
          throw new ApiError(
            "This record changed. Keep your draft and reload the latest version.",
            409,
          );
        revisions(structuredClone(previous));
        const next = {
          ...previous,
          ...body,
          id: previous.id,
          kind: previous.kind,
          version: previous.version + 1,
          updatedAt: new Date().toISOString(),
        } as WorkRecord;
        state.records = state.records.map((item) =>
          item.id === previous.id ? next : item,
        );
        persist();
        return { record: next };
      }
      if (method === "DELETE") {
        previous.deletedAt = new Date().toISOString();
        previous.version++;
        persist();
        return { success: true };
      }
      return { record: previous };
    }
    if (url.pathname.startsWith("/api/attachments/") && method === "DELETE") {
      const id = url.pathname.split("/").pop()!;
      state.attachments = state.attachments.filter((item) => item.id !== id);
      delete state.files[id];
      persist();
      return { success: true };
    }
    if (url.pathname === "/api/export")
      return {
        format: "work-export",
        version: 1,
        exportedAt: new Date().toISOString(),
        records: state.records,
        revisions: state.revisions,
        preferences: state.preferences,
        attachments: state.attachments.map((item) => ({
          ...item,
          ...(url.searchParams.get("files") === "false"
            ? {}
            : { base64: state.files[item.id] }),
        })),
      };
    if (url.pathname === "/api/import" && method === "GET")
      return { batches: state.batches ?? [] };
    if (/^\/api\/import\/[^/]+\/undo$/.test(url.pathname)) {
      const batch = state.batches?.find(
        (item) => item.id === url.pathname.split("/")[3],
      );
      if (!batch) throw new ApiError("Import not found.", 404);
      if (batch.undoneAt) return { undone: true };
      if (
        batch.changes.some(
          (change) => record(change.id).version !== change.version,
        )
      )
        throw new ApiError(
          "Some imported records were edited later. Keep those edits; reconcile them individually.",
          409,
        );
      for (const change of batch.changes) {
        const current = record(change.id);
        revisions(structuredClone(current));
        const next = change.before
          ? {
              ...change.before,
              version: current.version + 1,
              updatedAt: new Date().toISOString(),
            }
          : {
              ...current,
              version: current.version + 1,
              deletedAt: new Date().toISOString(),
            };
        state.records = state.records.map((item) =>
          item.id === current.id ? next : item,
        );
      }
      batch.undoneAt = new Date().toISOString();
      persist();
      return { undone: true };
    }
    if (url.pathname === "/api/import" && method === "POST") {
      const items = body.records as ImportItem[];
      let skipped = 0;
      let updated = 0;
      const created: WorkRecord[] = [];
      const ids = new Map<string, string>();
      const batch: DemoBatch = {
        id: crypto.randomUUID(),
        source: String(body.source),
        createdAt: new Date().toISOString(),
        undoneAt: null,
        created: 0,
        updated: 0,
        skipped: 0,
        changes: [],
      };
      for (const item of items)
        ids.set(
          item.sourceId,
          state.records.find(
            (row) =>
              row.data.sourceId === item.sourceId &&
              row.data.source === body.source,
          )?.id ?? crypto.randomUUID(),
        );
      const rewrite = (value: string, attachments: Map<string, string>) =>
        value
          .replace(
            /work-source:\/\/([^\s)\]>]+)/g,
            (_match, source: string) =>
              `/notes?record=${ids.get(decodeURIComponent(source)) ?? ""}`,
          )
          .replace(
            /work-attachment:\/\/([^\s)\]>]+)/g,
            (_match, filename: string) =>
              `/api/attachments/${attachments.get(decodeURIComponent(filename)) ?? ""}`,
          );
      for (const item of items) {
        const existing = state.records.find(
          (row) =>
            row.data.sourceId === item.sourceId &&
            row.data.source === body.source,
        );
        if (
          existing &&
          (body.mode === "keep" || existing.data.sourceHash === item.hash)
        ) {
          skipped++;
          continue;
        }
        const attachments = new Map<string, string>();
        for (const file of item.attachments ?? []) {
          const attachment: Attachment = {
            id: crypto.randomUUID(),
            recordId: ids.get(item.sourceId)!,
            filename: file.filename,
            contentType: file.contentType,
            size: atob(file.base64).length,
            createdAt: new Date().toISOString(),
          };
          state.attachments.push(attachment);
          state.files[attachment.id] = file.base64;
          attachments.set(file.filename, attachment.id);
        }
        const input = {
          ...item.record,
          body: rewrite(item.record.body ?? "", attachments),
          links: (item.record.links ?? []).map((id) => ids.get(id) ?? id),
          data: {
            ...item.record.data,
            sourceId: item.sourceId,
            source: body.source,
            sourceHash: item.hash,
            ...(item.record.kind === "asset" && attachments.size
              ? { primaryAttachmentId: [...attachments.values()][0] }
              : {}),
          },
        };
        if (existing && body.mode === "merge")
          input.body = `${existing.body}\n\n---\n\n${input.body}`;
        const value = existing
          ? {
              ...existing,
              ...input,
              version: existing.version + 1,
              updatedAt: new Date().toISOString(),
            }
          : { ...makeRecord(input), id: ids.get(item.sourceId)! };
        batch.changes.push({
          id: value.id,
          version: value.version,
          before: existing ? structuredClone(existing) : null,
        });
        if (existing) {
          updated++;
          revisions(structuredClone(existing));
          state.records = state.records.map((row) =>
            row.id === existing.id ? value : row,
          );
        } else state.records.push(value);
        created.push(value);
      }
      batch.created = created.length - updated;
      batch.updated = updated;
      batch.skipped = skipped;
      state.batches = [...(state.batches ?? []), batch];
      persist();
      return {
        batchId: batch.id,
        created: batch.created,
        updated,
        skipped,
        warnings: [],
        records: created,
      };
    }
    if (url.pathname === "/api/restore") {
      const fingerprint =
        String(body.exportedAt) + JSON.stringify(body.records);
      if (state.restored?.[fingerprint]) return state.restored[fingerprint];
      const payload = body.records as WorkRecord[];
      const files = (body.attachments ?? []) as (Attachment & {
        base64?: string;
      })[];
      const ids = new Map(
        payload.map((item) => [item.id, crypto.randomUUID()]),
      );
      const fileIds = new Map(
        files.map((item) => [item.id, crypto.randomUUID()]),
      );
      const warnings: string[] = [];
      const remap = (value: unknown): unknown =>
        typeof value === "string"
          ? (ids.get(value) ??
            fileIds.get(value) ??
            value.replace(
              /\/api\/attachments\/([^\s)\]>]+)/g,
              (match, id: string) =>
                fileIds.has(id) ? `/api/attachments/${fileIds.get(id)}` : match,
            ))
          : Array.isArray(value)
            ? value.map(remap)
            : value && typeof value === "object"
              ? Object.fromEntries(
                  Object.entries(value).map(([key, item]) => [
                    key,
                    remap(item),
                  ]),
                )
              : value;
      for (const item of payload)
        state.records.push({
          ...item,
          id: ids.get(item.id)!,
          links: item.links.map((id) => ids.get(id) ?? id),
          body: remap(item.body) as string,
          data: remap(item.data) as WorkRecord["data"],
        });
      for (const item of (body.revisions ?? []) as RecordRevision[])
        state.revisions.push({
          ...item,
          id: crypto.randomUUID(),
          recordId: ids.get(item.recordId)!,
          links: item.links.map((id) => ids.get(id) ?? id),
          body: remap(item.body) as string,
          data: remap(item.data) as WorkRecord["data"],
        });
      for (const file of files) {
        const id = fileIds.get(file.id)!;
        state.attachments.push({
          ...file,
          id,
          recordId: ids.get(file.recordId)!,
        });
        if (file.base64) state.files[id] = file.base64;
        else
          warnings.push(
            `${file.filename}: file bytes absent from metadata archive.`,
          );
      }
      state.preferences = {
        ...DEFAULT_PREFERENCES,
        ...(body.preferences as UserPreferences),
      };
      const result = {
        restored: payload.length,
        attachments: files.length,
        warnings,
      };
      state.restored = { ...state.restored, [fingerprint]: result };
      persist();
      return result;
    }
    throw new ApiError("This preview operation is unavailable.", 404);
  };
  persist();
  return {
    adapter,
    getRecords: () => state.records.filter((item) => !item.deletedAt),
    getPreferences: () => state.preferences,
    persist,
    fileUrl: async (id: string) => {
      if (urls.has(id)) return urls.get(id)!;
      const item = state.attachments.find((row) => row.id === id);
      if (!item) throw new ApiError("File not found.", 404);
      const bytes = Uint8Array.from(atob(state.files[id]), (char) =>
        char.charCodeAt(0),
      );
      const url = URL.createObjectURL(
        new Blob([bytes], { type: item.contentType }),
      );
      urls.set(id, url);
      return url;
    },
  };
}
