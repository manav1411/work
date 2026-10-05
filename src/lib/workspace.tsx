import { editorDraftsFor } from "./device-drafts";
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
}

interface WorkspaceValue {
  records: WorkRecord[];
  user: WorkUser | null;
  preferences: UserPreferences;
  mode: WorkspaceMode;
  loading: boolean;
  pending: number;
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
  savePreferences: (patch: Partial<UserPreferences>) => Promise<void>;
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
  const syncingItemRef = useRef<string | null>(null);
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
    if (!userRef.current) return;
    const response = await request<{ records: WorkRecord[] }>("/api/records");
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
        setUser(session.user);
        setConfigured(session.configured);
        setMode(session.local ? "local" : "cloud");
        if (session.user) {
          try {
            outboxRef.current = JSON.parse(
              localStorage.getItem(`work-outbox:${session.user.id}`) ?? "[]",
            ) as OutboxItem[];
          } catch {
            outboxRef.current = [];
          }
          setPending(outboxRef.current.length);
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
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotion = () => { document.documentElement.dataset.reduceMotion = String(query.matches); };
    updateMotion(); query.addEventListener('change', updateMotion);
    return () => query.removeEventListener('change', updateMotion);
  }, [preferences.theme, loading]);

  const create = useCallback(
    async (input: RecordInput): Promise<WorkRecord> => {
      const key = crypto.randomUUID();
      try {
        const response = await request<{ record: WorkRecord }>("/api/records", {
          ...jsonRequest("POST", input),
          headers: { "Idempotency-Key": key },
        });
        put(response.record);
        return response.record;
      } catch (failure) {
        if (
          failure instanceof ApiError &&
          failure.status === 0 &&
          userRef.current
        ) {
          const optimistic = makeRecord(input);
          optimistic.id = `offline-${key}`;
          put(optimistic);
          outboxRef.current.push({
            id: key,
            method: "create",
            recordId: optimistic.id,
            input,
          });
          persistOutbox();
          notify(
            "Captured on this device. It will sync when you reconnect.",
            "info",
          );
          return optimistic;
        }
        throw failure;
      }
    },
    [notify, persistOutbox, put],
  );

  const update = useCallback(
    async (
      id: string,
      patch: RecordPatch,
      expectedVersion?: number,
    ): Promise<WorkRecord> => {
      const save = async (): Promise<WorkRecord> => {
        id = aliasesRef.current.get(id) ?? id;
        const previous = recordsRef.current.find((record) => record.id === id);
        if (!previous) throw new ApiError("Record no longer exists.", 404);
        if (
          expectedVersion !== undefined &&
          previous.version !== expectedVersion
        )
          throw new ApiError(
            "This record changed while you were editing. Review the latest saved text before saving your draft.",
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
          const next = {
            ...previous,
            ...patch,
            updatedAt: new Date().toISOString(),
          };
          put(next);
          persistOutbox();
          return next;
        }
        try {
          const response = await request<{ record: WorkRecord }>(
            `/api/records/${encodeURIComponent(id)}`,
            {
              ...jsonRequest("PATCH", { ...patch, version: previous.version }),
              headers: { "Idempotency-Key": crypto.randomUUID() },
            },
          );
          put(response.record);
          return response.record;
        } catch (failure) {
          if (
            failure instanceof ApiError &&
            failure.status === 0 &&
            userRef.current
          ) {
            const existing = outboxRef.current.find(
              (item) => item.method === "update" && item.recordId === id,
            );
            if (existing) existing.patch = { ...existing.patch, ...patch };
            else
              outboxRef.current.push({
                id: crypto.randomUUID(),
                method: "update",
                recordId: id,
                patch,
                version: previous.version,
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
      const response = await request<{ preferences: UserPreferences }>(
        "/api/preferences",
        jsonRequest("PUT", { ...preferencesRef.current, ...patch }),
      );
      setPreferences({ ...DEFAULT_PREFERENCES, ...response.preferences });
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
    if (syncRef.current || !outboxRef.current.length || !userRef.current)
      return;
    syncRef.current = true;
    try {
      while (outboxRef.current.length) {
        const item = structuredClone(outboxRef.current[0]);
        syncingItemRef.current = item.id;
        if (item.method === "create" && item.input) {
          const response = await request<{ record: WorkRecord }>(
            "/api/records",
            {
              ...jsonRequest("POST", item.input),
              headers: { "Idempotency-Key": item.id },
            },
          );
          const latest = outboxRef.current.find(
            (queued) => queued.id === item.id,
          );
          const edited =
            latest?.input &&
            JSON.stringify(latest.input) !== JSON.stringify(item.input);
          recordsRef.current = recordsRef.current.filter(
            (record) => record.id !== item.recordId,
          );
          put(response.record);
          const previousId = item.recordId;
          aliasesRef.current.set(previousId, response.record.id);
          outboxRef.current = outboxRef.current.map((queued) =>
            remapReference(queued, previousId, response.record.id),
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
              patch,
            });
            put({ ...response.record, ...patch } as WorkRecord);
          }
          for (const scope of ["local", "cloud", "demo"]) {
            const oldKey = `work:note-draft:${scope}:${userRef.current.id}:${previousId}`;
            const draft = localStorage.getItem(oldKey);
            if (draft) {
              localStorage.setItem(
                `work:note-draft:${scope}:${userRef.current.id}:${response.record.id}`,
                draft,
              );
              localStorage.removeItem(oldKey);
            }
          }
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
          const response = await request<{ record: WorkRecord }>(
            `/api/records/${encodeURIComponent(item.recordId)}`,
            {
              ...jsonRequest("PATCH", { ...item.patch, version: item.version }),
              headers: { "Idempotency-Key": item.id },
            },
          );
          put(response.record);
          const latest = outboxRef.current.find(
            (queued) => queued.id === item.id,
          );
          if (
            latest?.patch &&
            JSON.stringify(latest.patch) !== JSON.stringify(item.patch)
          ) {
            outboxRef.current.push({
              id: crypto.randomUUID(),
              method: "update",
              recordId: item.recordId,
              version: response.record.version,
              patch: latest.patch,
            });
            put({ ...response.record, ...latest.patch });
          }
        } else
          await request(`/api/records/${encodeURIComponent(item.recordId)}`, {
            method: "DELETE",
          });
        outboxRef.current = outboxRef.current.filter(
          (queued) => queued.id !== item.id,
        );
        syncingItemRef.current = null;
        persistOutbox();
      }
      setError("");
      await refresh();
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 409) {
        setError(
          "An offline draft conflicts with a newer edit. Export your drafts in Settings before replacing anything.",
        );
        notify("An offline draft needs your attention in Settings.", "error");
      } else if (failure instanceof ApiError && failure.status !== 0) {
        setError(
          `A device draft could not sync: ${failure.message} Export or recover it in Settings.`,
        );
        notify("A device draft needs your attention in Settings.", "error");
      }
    } finally {
      syncRef.current = false;
      syncingItemRef.current = null;
    }
  }, [notify, persistOutbox, put, refresh]);
  useEffect(() => {
    const handle = () => {
      void syncOutbox();
      if (document.visibilityState === "visible" && !outboxRef.current.length)
        void refresh().catch(() => undefined);
    };
    window.addEventListener("online", handle);
    window.addEventListener("focus", handle);
    const interval = setInterval(handle, 60000);
    void syncOutbox();
    return () => {
      window.removeEventListener("online", handle);
      window.removeEventListener("focus", handle);
      clearInterval(interval);
    };
  }, [refresh, syncOutbox, user]);
  const signOut = useCallback(async () => {
    if (
      outboxRef.current.length ||
      editorDraftsFor(userRef.current?.id ?? "").length
    )
      throw new ApiError(
        "You have device drafts. Review or download and discard them in Settings before signing out.",
        409,
      );
    if (mode !== "demo")
      await request("/api/auth/sign-out", jsonRequest("POST", {}));
    sessionStorage.removeItem("work-demo-active");
    setApiAdapter(null);
    userRef.current = null;
    setUser(null);
    setRecords([]);
    recordsRef.current = [];
    setMode("cloud");
    setPreferences({ ...DEFAULT_PREFERENCES });
    location.assign("/");
  }, [mode]);
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
          "Download the device drafts first; the original record is no longer available.",
          409,
        );
      const input: RecordInput = item.input ?? {
        kind: draft!.kind,
        title: `${draft!.title} (recovered device draft)`,
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
      notify(
        "Your draft is saved as a separate record. The newer original is unchanged.",
      );
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
