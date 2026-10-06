import { resumePendingSources, resumePendingSettings } from "./pending-source";
import { editorDraftsFor, remapEditorDrafts } from "./device-drafts";
import { flushAutosaves, mergeAutosaveValues } from "./autosave";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_PREFERENCES,
  type RecordInput,
  type RecordPatch,
  type SessionResponse,
  type UserPreferences,
  type WorkRecord,
  type WorkUser,
} from "../../shared/model";
import { STARTER_RECORDS } from "../content/starter";
import { ApiError, jsonRequest, request, setApiAdapter } from "./api";
import { createDemoStore, makeRecord } from "./demo";
import { remapReference } from "./outbox";

export type WorkspaceMode = "cloud" | "local" | "demo";
export interface Toast {
  id: string;
  message: string;
  tone: "success" | "error" | "info";
}
interface OutboxItem {
  id: string;
  method: "create" | "update" | "remove";
  recordId: string;
  input?: RecordInput;
  patch?: RecordPatch;
  version?: number;
  base?: WorkRecord;
  sent?: { input?: RecordInput; patch?: RecordPatch; version?: number };
  issue?: string;
}

const temporarySaveFailure = (failure: unknown) =>
  failure instanceof ApiError &&
  (failure.status === 0 ||
    failure.status === 408 ||
    failure.status === 429 ||
    failure.status >= 500);

interface WorkspaceValue {
  records: WorkRecord[];
  user: WorkUser | null;
  preferences: UserPreferences;
  mode: WorkspaceMode;
  loading: boolean;
  pending: number;
  isPending: (recordId: string) => boolean;
  syncIssues: { id: string; recordId: string; message: string }[];
  error: string;
  configured: boolean;
  toasts: Toast[];
  create: (input: RecordInput) => Promise<WorkRecord>;
  update: (
    id: string,
    patch: RecordPatch,
    expectedVersion?: number,
  ) => Promise<WorkRecord>;
  remove: (id: string) => Promise<void>;
  restore: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
  notify: (message: string, tone?: Toast["tone"]) => void;
  dismissToast: (id: string) => void;
  savePreferences: (
    patch: Partial<UserPreferences>,
  ) => Promise<UserPreferences>;
  openDemo: () => void;
  signOut: () => Promise<void>;
  initialize: () => Promise<void>;
  syncOutbox: () => Promise<void>;
  recoverDraft: (queueId: string) => Promise<void>;
  discardDraft: (queueId: string) => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [records, setRecords] = useState<WorkRecord[]>([]);
  const [user, setUser] = useState<WorkUser | null>(null);
  const [preferences, setPreferences] = useState<UserPreferences>({
    ...DEFAULT_PREFERENCES,
  });
  const [mode, setMode] = useState<WorkspaceMode>("cloud");
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [pending, setPending] = useState(0);
  const [outboxRevision, setOutboxRevision] = useState(0);
  const [error, setError] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const recordsRef = useRef(records);
  recordsRef.current = records;
  const userRef = useRef(user);
  userRef.current = user;
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  const outboxRef = useRef<OutboxItem[]>([]);
  const syncRef = useRef(false);
  const sourceSyncRef = useRef(false);
  const syncingItemRef = useRef<string | null>(null);
  const signingOutRef = useRef(false);
  const retryDelayRef = useRef(1000);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const aliasesRef = useRef(new Map<string, string>());
  const updateQueues = useRef(new Map<string, Promise<unknown>>());
  const notify = useCallback(
    (message: string, tone: Toast["tone"] = "success") => {
      const id = crypto.randomUUID();
      setToasts((previous) => [...previous.slice(-3), { id, message, tone }]);
      setTimeout(
        () =>
          setToasts((previous) => previous.filter((item) => item.id !== id)),
        tone === "error" ? 9000 : 4500,
      );
    },
    [],
  );
  const dismissToast = useCallback(
    (id: string) =>
      setToasts((previous) => previous.filter((item) => item.id !== id)),
    [],
  );
  const persistOutbox = useCallback(() => {
    setPending(outboxRef.current.length);
    setOutboxRevision((revision) => revision + 1);
    if (userRef.current)
      try {
        localStorage.setItem(
          `work-outbox:${userRef.current.id}`,
          JSON.stringify(outboxRef.current),
        );
      } catch {
        notify(
          "Device storage is full. Export unsynced work before leaving.",
          "error",
        );
      }
  }, [notify]);
  const isPending = useCallback(
    (recordId: string) =>
      outboxRef.current.some(
        (entry) =>
          entry.recordId === (aliasesRef.current.get(recordId) ?? recordId),
      ),
    // Changing queue contents also changes the status of mounted editors.
    [outboxRevision],
  );
  const syncIssues = useMemo(
    () =>
      outboxRef.current
        .filter((entry) => entry.issue)
        .map((entry) => ({
          id: entry.id,
          recordId: entry.recordId,
          message: entry.issue!,
        })),
    [outboxRevision],
  );
  const put = useCallback((record: WorkRecord) => {
    const next = recordsRef.current.some((item) => item.id === record.id)
      ? recordsRef.current.map((item) =>
          item.id === record.id ? record : item,
        )
      : [...recordsRef.current, record];
    recordsRef.current = next.filter((item) => !item.deletedAt);
    setRecords(recordsRef.current);
  }, []);
  const refresh = useCallback(async () => {
    const owner = userRef.current?.id;
    if (!owner || signingOutRef.current) return;
    const response = await request<{ records: WorkRecord[] }>("/api/records");
    if (userRef.current?.id !== owner || signingOutRef.current) return;
    const queued = outboxRef.current;
    const base = response.records.filter((item) => !item.deletedAt);
    for (const item of queued) {
      if (item.method === "create" && item.input) {
        const optimistic = recordsRef.current.find(
          (record) => record.id === item.recordId,
        );
        if (optimistic) base.push(optimistic);
      }
      if (item.method === "update") {
        const index = base.findIndex((record) => record.id === item.recordId);
        if (index >= 0) base[index] = { ...base[index], ...item.patch };
      }
      if (item.method === "remove") {
        const index = base.findIndex((record) => record.id === item.recordId);
        if (index >= 0) base.splice(index, 1);
      }
    }
    recordsRef.current = base;
    setRecords(base);
  }, []);
  const openDemo = useCallback(() => {
    signingOutRef.current = false;
    sessionStorage.removeItem("work:signout-save-notice");
    const demo = createDemoStore();
    setApiAdapter(demo.adapter, demo.fileUrl);
    sessionStorage.setItem("work-demo-active", "true");
    const next = demo.getRecords();
    recordsRef.current = next;
    setRecords(next);
    const nextUser = { id: "demo", name: "Manav", email: "Preview workspace" };
    userRef.current = nextUser;
    setUser(nextUser);
    setPreferences(demo.getPreferences());
    setMode("demo");
    setConfigured(true);
    setLoading(false);
    setError("");
    outboxRef.current = [];
    setPending(0);
    setOutboxRevision((revision) => revision + 1);
  }, []);

  useEffect(() => {
    let active = true;
    const start = async () => {
      if (sessionStorage.getItem("work-demo-active") === "true") {
        openDemo();
        return;
      }
      setApiAdapter(null);
      try {
        const session = await request<SessionResponse>("/api/session");
        if (!active) return;
        userRef.current = session.user;
        signingOutRef.current = false;
        setUser(session.user);
        setConfigured(session.configured);
        setMode(session.local ? "local" : "cloud");
        if (session.user) {
          sessionStorage.removeItem("work:signout-save-notice");
          try {
            outboxRef.current = JSON.parse(
              localStorage.getItem(`work-outbox:${session.user.id}`) ?? "[]",
            ) as OutboxItem[];
          } catch {
            outboxRef.current = [];
          }
          setPending(outboxRef.current.length);
          setOutboxRevision((revision) => revision + 1);
          const [rows, prefs] = await Promise.all([
            request<{ records: WorkRecord[] }>("/api/records"),
            request<{ preferences: UserPreferences }>("/api/preferences"),
          ]);
          if (!active) return;
          recordsRef.current = rows.records.filter(
            (record) => !record.deletedAt,
          );
          setRecords(recordsRef.current);
          setPreferences({ ...DEFAULT_PREFERENCES, ...prefs.preferences });
          for (const item of outboxRef.current)
            if (item.method === "create" && item.input)
              put({ ...makeRecord(item.input), id: item.recordId });
          await refresh();
        }
      } catch (failure) {
        if (active)
          setError(
            failure instanceof Error ? failure.message : "Work could not load.",
          );
      } finally {
        if (active) setLoading(false);
      }
    };
    void start();
    return () => {
      active = false;
    };
  }, [openDemo, put, refresh]);

  useEffect(() => {
    if (loading) return;
    document.documentElement.dataset.theme = preferences.theme;
    try {
      localStorage.setItem("work:theme", preferences.theme);
    } catch {
      /* Theme still applies to this session. */
    }
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => {
      document.documentElement.dataset.reduceMotion = String(query.matches);
    };
    updateMotion();
    query.addEventListener("change", updateMotion);
    return () => query.removeEventListener("change", updateMotion);
  }, [preferences.theme, loading]);

  const create = useCallback(
    async (input: RecordInput): Promise<WorkRecord> => {
      const owner = userRef.current?.id;
      if (!owner || signingOutRef.current)
        throw new ApiError("Sign in to finish saving your changes.", 401);
      const key = crypto.randomUUID();
      try {
        const response = await request<{ record: WorkRecord }>("/api/records", {
          ...jsonRequest("POST", input),
          headers: { "Idempotency-Key": key },
        });
        if (userRef.current?.id === owner) put(response.record);
        return response.record;
      } catch (failure) {
        if (temporarySaveFailure(failure) && userRef.current?.id === owner) {
          const optimistic = makeRecord(input);
          optimistic.id = `offline-${key}`;
          put(optimistic);
          outboxRef.current.push({
            id: key,
            method: "create",
            recordId: optimistic.id,
            input,
            sent: { input: structuredClone(input) },
          });
          persistOutbox();
          return optimistic;
        }
        throw failure;
      }
    },
    [persistOutbox, put],
  );

  const update = useCallback(
    async (
      id: string,
      patch: RecordPatch,
      expectedVersion?: number,
    ): Promise<WorkRecord> => {
      const owner = userRef.current?.id;
      const save = async (): Promise<WorkRecord> => {
        if (!owner || userRef.current?.id !== owner || signingOutRef.current)
          throw new ApiError("Sign in to finish saving your changes.", 401);
        id = aliasesRef.current.get(id) ?? id;
        const previous = recordsRef.current.find((record) => record.id === id);
        if (!previous) throw new ApiError("Record no longer exists.", 404);
        if (
          expectedVersion !== undefined &&
          previous.version !== expectedVersion
        )
          throw new ApiError(
            "This content changed elsewhere. Review both copies.",
            409,
            { record: previous },
          );
        const queuedCreate = outboxRef.current.find(
          (item) => item.method === "create" && item.recordId === id,
        );
        if (queuedCreate?.input) {
          queuedCreate.input = { ...queuedCreate.input, ...patch };
          const next = {
            ...previous,
            ...patch,
            updatedAt: new Date().toISOString(),
          };
          put(next);
          persistOutbox();
          return next;
        }
        const queuedUpdate = outboxRef.current.find(
          (item) => item.method === "update" && item.recordId === id,
        );
        if (queuedUpdate) {
          queuedUpdate.patch = { ...queuedUpdate.patch, ...patch };
          // Editing an invalid value allows this item to be retried. Genuine
          // overlaps will be checked against the server again during sync.
          if (queuedUpdate.issue) {
            queuedUpdate.id = crypto.randomUUID();
            delete queuedUpdate.sent;
            delete queuedUpdate.issue;
          }
          const next = {
            ...previous,
            ...patch,
            updatedAt: new Date().toISOString(),
          };
          put(next);
          persistOutbox();
          return next;
        }
        const requestId = crypto.randomUUID();
        try {
          const response = await request<{ record: WorkRecord }>(
            `/api/records/${encodeURIComponent(id)}`,
            {
              ...jsonRequest("PATCH", { ...patch, version: previous.version }),
              headers: { "Idempotency-Key": requestId },
            },
          );
          if (userRef.current?.id === owner) put(response.record);
          return response.record;
        } catch (failure) {
          if (failure instanceof ApiError && failure.status === 409) {
            const latest = await request<{ record: WorkRecord }>(
              `/api/records/${encodeURIComponent(id)}`,
            ).catch(() => undefined);
            if (
              latest &&
              userRef.current?.id === owner &&
              !signingOutRef.current
            )
              put(latest.record);
          }
          if (temporarySaveFailure(failure) && userRef.current?.id === owner) {
            const existing = outboxRef.current.find(
              (item) => item.method === "update" && item.recordId === id,
            );
            if (existing) existing.patch = { ...existing.patch, ...patch };
            else
              outboxRef.current.push({
                id: requestId,
                method: "update",
                recordId: id,
                patch,
                version: previous.version,
                base: structuredClone(previous),
                sent: {
                  patch: structuredClone(patch),
                  version: previous.version,
                },
              });
            const next = {
              ...previous,
              ...patch,
              updatedAt: new Date().toISOString(),
            };
            put(next);
            persistOutbox();
            return next;
          }
          throw failure;
        }
      };
      const prior = updateQueues.current.get(id) ?? Promise.resolve();
      const promise = prior.catch(() => undefined).then(save);
      updateQueues.current.set(id, promise);
      try {
        return await promise;
      } finally {
        if (updateQueues.current.get(id) === promise)
          updateQueues.current.delete(id);
      }
    },
    [persistOutbox, put],
  );

  const remove = useCallback(
    async (id: string) => {
      id = aliasesRef.current.get(id) ?? id;
      const queued = outboxRef.current.find(
        (item) => item.method === "create" && item.recordId === id,
      );
      if (queued && queued.id === syncingItemRef.current)
        throw new ApiError(
          "This record is syncing. Wait a moment before moving it to trash.",
          409,
        );
      if (queued)
        outboxRef.current = outboxRef.current.filter(
          (item) => item.recordId !== id,
        );
      else
        await request(`/api/records/${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
      recordsRef.current = recordsRef.current.filter(
        (record) => record.id !== id,
      );
      setRecords(recordsRef.current);
      persistOutbox();
    },
    [persistOutbox],
  );
  const restore = useCallback(
    async (id: string) => {
      await request(`/api/records/${encodeURIComponent(id)}/restore`, {
        method: "POST",
      });
      await refresh();
    },
    [refresh],
  );
  const savePreferences = useCallback(
    async (patch: Partial<UserPreferences>) => {
      const owner = userRef.current?.id;
      if (!owner || signingOutRef.current)
        throw new ApiError("Sign in to finish saving your changes.", 401);
      const base = preferencesRef.current;
      const desired = { ...base, ...patch };
      const { preferences: fetched } = await request<{
        preferences: UserPreferences;
      }>("/api/preferences");
      if (userRef.current?.id !== owner || signingOutRef.current)
        throw new ApiError("Sign in to finish saving your changes.", 401);
      const remote = { ...DEFAULT_PREFERENCES, ...fetched };
      const merged = mergeAutosaveValues(base, desired, remote);
      if (merged.conflict) {
        preferencesRef.current = remote;
        setPreferences(remote);
        throw new ApiError(
          "These settings also changed in another session. Review both copies.",
          409,
        );
      }
      const response = await request<{ preferences: UserPreferences }>(
        "/api/preferences",
        jsonRequest("PUT", merged.value),
      );
      const saved = { ...DEFAULT_PREFERENCES, ...response.preferences };
      if (userRef.current?.id === owner && !signingOutRef.current) {
        preferencesRef.current = saved;
        setPreferences(saved);
      }
      return saved;
    },
    [],
  );
  const initialize = useCallback(async () => {
    const response = await request<{ records: WorkRecord[] }>(
      "/api/records/batch",
      jsonRequest("POST", {
        records: STARTER_RECORDS,
        idempotencyKey: "starter-workspace-v1",
      }),
    );
    for (const record of response.records) put(record);
    // An idempotent setup response can predate subsequent edits to starters.
    await refresh();
    notify("Your workspace is ready. Pick one small next move.");
  }, [notify, put, refresh]);
  const syncOutbox = useCallback(async () => {
    const owner = userRef.current?.id;
    if (syncRef.current || signingOutRef.current || !owner) return;
    syncRef.current = true;
    try {
      while (userRef.current?.id === owner && !signingOutRef.current) {
        const queued = outboxRef.current.find((entry) => !entry.issue);
        if (!queued) break;
        // Retry the exact attempted payload with its original request key. New
        // typing becomes a subsequent request after the acknowledgement.
        queued.sent ??= structuredClone({
          input: queued.input,
          patch: queued.patch,
          version: queued.version,
        });
        persistOutbox();
        const item = structuredClone(queued);
        syncingItemRef.current = item.id;
        try {
          if (item.method === "create" && item.sent?.input) {
            const response = await request<{ record: WorkRecord }>(
              "/api/records",
              {
                ...jsonRequest("POST", item.sent.input),
                headers: { "Idempotency-Key": item.id },
              },
            );
            if (userRef.current?.id !== owner || signingOutRef.current) return;
            const latest = outboxRef.current.find(
              (entry) => entry.id === item.id,
            );
            const previousId = item.recordId;
            const edited =
              latest?.input &&
              JSON.stringify(latest.input) !== JSON.stringify(item.sent.input);
            recordsRef.current = recordsRef.current.filter(
              (record) => record.id !== previousId,
            );
            put(response.record);
            aliasesRef.current.set(previousId, response.record.id);
            outboxRef.current = outboxRef.current.map((entry) =>
              remapReference(entry, previousId, response.record.id),
            );
            recordsRef.current = recordsRef.current.map((record) =>
              remapReference(record, previousId, response.record.id),
            );
            setRecords(recordsRef.current);
            if (edited && latest?.input) {
              const input = remapReference(
                latest.input,
                previousId,
                response.record.id,
              );
              const patch = {
                title: input.title,
                body: input.body,
                tags: input.tags,
                links: input.links,
                data: input.data,
              };
              outboxRef.current.push({
                id: crypto.randomUUID(),
                method: "update",
                recordId: response.record.id,
                version: response.record.version,
                base: response.record,
                patch,
              });
              put({ ...response.record, ...patch } as WorkRecord);
            }
            remapEditorDrafts(owner, previousId, response.record.id);
            const current = new URL(location.href);
            let moved = false;
            for (const key of ["record", "action"])
              if (current.searchParams.get(key) === previousId) {
                current.searchParams.set(key, response.record.id);
                moved = true;
              }
            if (moved) {
              history.replaceState(
                history.state,
                "",
                current.pathname + current.search,
              );
              window.dispatchEvent(new PopStateEvent("popstate"));
            }
          } else if (item.method === "update") {
            let response: { record: WorkRecord };
            try {
              response = await request(
                `/api/records/${encodeURIComponent(item.recordId)}`,
                {
                  ...jsonRequest("PATCH", {
                    ...item.sent?.patch,
                    version: item.sent?.version,
                  }),
                  headers: { "Idempotency-Key": item.id },
                },
              );
            } catch (failure) {
              if (!(failure instanceof ApiError) || failure.status !== 409)
                throw failure;
              const { record: remote } = await request<{ record: WorkRecord }>(
                `/api/records/${encodeURIComponent(item.recordId)}`,
              );
              if (userRef.current?.id !== owner || signingOutRef.current)
                return;
              const latest = outboxRef.current.find(
                (entry) => entry.id === item.id,
              );
              if (!latest) continue;
              if (!item.base || remote.deletedAt) {
                latest.issue =
                  "This saved record also changed. Review your local changes before replacing it.";
                persistOutbox();
                continue;
              }
              const authored = (record: WorkRecord) => ({
                title: record.title,
                body: record.body,
                tags: record.tags,
                links: record.links,
                data: record.data,
              });
              const local = { ...authored(item.base), ...latest.patch };
              const merged = mergeAutosaveValues(
                authored(item.base),
                local,
                authored(remote),
              );
              if (merged.conflict) {
                latest.issue =
                  "Another session edited the same content. Both copies are kept; review this change.";
                persistOutbox();
                continue;
              }
              const patch = Object.fromEntries(
                Object.entries(merged.value).filter(
                  ([key, value]) =>
                    JSON.stringify(value) !==
                    JSON.stringify(
                      authored(remote)[
                        key as keyof ReturnType<typeof authored>
                      ],
                    ),
                ),
              );
              if (!Object.keys(patch).length) {
                outboxRef.current = outboxRef.current.filter(
                  (entry) => entry.id !== item.id,
                );
                put(remote);
              } else {
                latest.id = crypto.randomUUID();
                latest.patch = patch;
                latest.version = remote.version;
                latest.base = remote;
                delete latest.sent;
                put({ ...remote, ...patch });
              }
              persistOutbox();
              continue;
            }
            if (userRef.current?.id !== owner || signingOutRef.current) return;
            put(response.record);
            const latest = outboxRef.current.find(
              (entry) => entry.id === item.id,
            );
            if (
              latest?.patch &&
              JSON.stringify(latest.patch) !== JSON.stringify(item.sent?.patch)
            ) {
              outboxRef.current.push({
                id: crypto.randomUUID(),
                method: "update",
                recordId: item.recordId,
                version: response.record.version,
                base: response.record,
                patch: latest.patch,
              });
              put({ ...response.record, ...latest.patch });
            }
          } else {
            await request(`/api/records/${encodeURIComponent(item.recordId)}`, {
              method: "DELETE",
            });
            if (userRef.current?.id !== owner || signingOutRef.current) return;
          }
          outboxRef.current = outboxRef.current.filter(
            (entry) => entry.id !== item.id,
          );
          retryDelayRef.current = 1000;
          persistOutbox();
        } catch (failure) {
          if (userRef.current?.id !== owner || signingOutRef.current) return;
          if (temporarySaveFailure(failure)) {
            retryDelayRef.current = Math.min(30000, retryDelayRef.current * 2);
            break;
          }
          const latest = outboxRef.current.find(
            (entry) => entry.id === item.id,
          );
          if (latest)
            latest.issue =
              failure instanceof Error
                ? failure.message
                : "This change could not be saved. Open it to correct the value.";
          persistOutbox();
        }
      }
      if (
        userRef.current?.id === owner &&
        !signingOutRef.current &&
        !outboxRef.current.length
      ) {
        setError("");
        await refresh();
      }
    } catch (failure) {
      if (!temporarySaveFailure(failure) && userRef.current?.id === owner)
        setError(
          failure instanceof Error
            ? failure.message
            : "Changes could not sync.",
        );
    } finally {
      syncRef.current = false;
      syncingItemRef.current = null;
      setOutboxRevision((revision) => revision + 1);
    }
  }, [persistOutbox, put, refresh]);
  const syncSources = useCallback(async () => {
    const owner = userRef.current?.id;
    if (!owner || signingOutRef.current || sourceSyncRef.current) return;
    sourceSyncRef.current = true;
    try {
      const canSave = () =>
        userRef.current?.id === owner && !signingOutRef.current;
      const changed = await resumePendingSources(owner, canSave);
      await resumePendingSettings(owner, canSave, (saved) => {
        preferencesRef.current = { ...DEFAULT_PREFERENCES, ...saved };
        setPreferences(preferencesRef.current);
      });
      if (changed && userRef.current?.id === owner) await refresh();
    } finally {
      sourceSyncRef.current = false;
    }
  }, [refresh]);
  useEffect(() => {
    const handle = () => {
      void syncOutbox();
      void syncSources();
      if (document.visibilityState === "visible" && !outboxRef.current.length)
        void refresh().catch(() => undefined);
    };
    window.addEventListener("online", handle);
    window.addEventListener("focus", handle);
    const interval = setInterval(handle, 60000);
    void syncOutbox();
    void syncSources();
    return () => {
      window.removeEventListener("online", handle);
      window.removeEventListener("focus", handle);
      clearInterval(interval);
    };
  }, [refresh, syncOutbox, syncSources, user]);
  useEffect(() => {
    clearTimeout(retryTimerRef.current);
    if (
      !user ||
      signingOutRef.current ||
      !outboxRef.current.some((entry) => !entry.issue)
    )
      return;
    retryTimerRef.current = setTimeout(
      () => void syncOutbox(),
      retryDelayRef.current,
    );
    return () => clearTimeout(retryTimerRef.current);
  }, [outboxRevision, syncOutbox, user]);
  const signOut = useCallback(async () => {
    await Promise.race([
      flushAutosaves()
        .then(() => syncOutbox())
        .catch(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, 1500)),
    ]);
    const owner = userRef.current?.id;
    const retained =
      outboxRef.current.length > 0 || editorDraftsFor(owner ?? "").length > 0;
    const localSignOut = mode === "local";
    signingOutRef.current = true;
    clearTimeout(retryTimerRef.current);
    try {
      if (mode !== "demo" && !localSignOut)
        await request("/api/auth/sign-out", jsonRequest("POST", {}));
    } catch (failure) {
      signingOutRef.current = false;
      setOutboxRevision((revision) => revision + 1);
      throw failure;
    }
    if (retained) {
      try {
        sessionStorage.setItem(
          "work:signout-save-notice",
          "Unfinished changes are kept on this device and will resume when you sign back in to the same account.",
        );
      } catch {
        /* Optional notice; account-scoped changes remain stored. */
      }
    }
    sessionStorage.removeItem("work-demo-active");
    setApiAdapter(null);
    userRef.current = null;
    setUser(null);
    setRecords([]);
    recordsRef.current = [];
    outboxRef.current = [];
    aliasesRef.current.clear();
    updateQueues.current.clear();
    setPending(0);
    setOutboxRevision((revision) => revision + 1);
    setMode("cloud");
    if (localSignOut) setConfigured(false);
    setPreferences({ ...DEFAULT_PREFERENCES });
    // Local development auth has no provider session to revoke; staying on
    // this page lets the user choose the demo instead of immediately being
    // signed back into the automatically provisioned local account.
    if (!localSignOut) location.assign("/");
  }, [mode, syncOutbox]);
  const recoverDraft = useCallback(
    async (queueId: string) => {
      if (syncRef.current)
        throw new ApiError("Wait for the current sync to finish.", 409);
      const item = outboxRef.current.find((draft) => draft.id === queueId);
      if (!item) return;
      const draft = recordsRef.current.find(
        (record) => record.id === item.recordId,
      );
      if (!draft && !item.input)
        throw new ApiError(
          "Download your local changes first; the original record is no longer available.",
          409,
        );
      const input: RecordInput = item.input ?? {
        kind: draft!.kind,
        title: `${draft!.title} (recovered changes)`,
        body: draft!.body,
        tags: draft!.tags,
        links: draft!.links,
        data: draft!.data,
      };
      const response = await request<{ record: WorkRecord }>("/api/records", {
        ...jsonRequest("POST", input),
        headers: { "Idempotency-Key": `recovery-${item.id}` },
      });
      outboxRef.current = outboxRef.current.filter(
        (queued) => queued.id !== queueId,
      );
      persistOutbox();
      put(response.record);
      setError("");
      await refresh();
      notify("Your changes are saved as a separate record.");
    },
    [notify, persistOutbox, put, refresh],
  );
  const discardDraft = useCallback(
    async (queueId: string) => {
      if (syncRef.current)
        throw new ApiError("Wait for the current sync to finish.", 409);
      const draft = outboxRef.current.find((item) => item.id === queueId);
      outboxRef.current = outboxRef.current.filter(
        (item) => item.id !== queueId,
      );
      if (draft?.method === "create")
        recordsRef.current = recordsRef.current.filter(
          (record) => record.id !== draft.recordId,
        );
      persistOutbox();
      setError("");
      await refresh();
    },
    [persistOutbox, refresh],
  );
  const value = useMemo<WorkspaceValue>(
    () => ({
      records,
      user,
      preferences,
      mode,
      loading,
      pending,
      isPending,
      syncIssues,
      error,
      configured,
      toasts,
      create,
      update,
      remove,
      restore,
      refresh,
      notify,
      dismissToast,
      savePreferences,
      openDemo,
      signOut,
      initialize,
      syncOutbox,
      recoverDraft,
      discardDraft,
    }),
    [
      records,
      user,
      preferences,
      mode,
      loading,
      pending,
      isPending,
      syncIssues,
      error,
      configured,
      toasts,
      create,
      update,
      remove,
      restore,
      refresh,
      notify,
      dismissToast,
      savePreferences,
      openDemo,
      signOut,
      initialize,
      syncOutbox,
      recoverDraft,
      discardDraft,
    ],
  );
  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceValue {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("WorkspaceProvider is required");
  return context;
}
