import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  learningUsername,
  type LearningFreshness,
  type LearningSourceResponse,
  type LeetCodeStats,
  type Week,
} from "../../../shared/learning";
import { request, jsonRequest } from "../../lib/api";
import { useWorkspace } from "../../lib/workspace";
import { DEMO_STATS, DEMO_WEEKS } from "./demo";
import { buildSolvedByDay, solvedSlugs } from "./foundations/leetcodeMetrics";

export interface LearningData {
  weeks: Week[];
  stats: LeetCodeStats | null;
  tasks: Record<string, boolean>;
  solvedSlugs: Set<string>;
  username: string;
  configured: boolean;
  loading: boolean;
  error: string | null;
  source: Record<"content" | "stats" | "progress", LearningFreshness>;
  pendingTasks: Set<string>;
}
interface LearningStore {
  value: LearningData;
  listeners: Set<() => void>;
  started: boolean;
  lastLoad: number;
  loadingRequest: Promise<void> | null;
  baseTasks: Record<string, boolean>;
  optimisticTasks: Map<string, boolean>;
  writeQueue: Promise<void>;
}
const stores = new Map<string, LearningStore>();
const freshness = () => ({ fetchedAt: null, stale: false });
function getStore(key: string, username: string, demo: boolean): LearningStore {
  const previous = stores.get(key);
  if (previous) return previous;
  let tasks: Record<string, boolean> = {};
  if (demo) {
    try {
      tasks = JSON.parse(
        localStorage.getItem("work-demo-learning-tasks") ?? "{}",
      );
    } catch {
      /* Device storage is optional. */
    }
  }
  const stats = demo ? DEMO_STATS : null;
  const store: LearningStore = {
    value: {
      weeks: demo ? DEMO_WEEKS : [],
      stats,
      tasks,
      solvedSlugs: stats ? solvedSlugs(buildSolvedByDay(stats)) : new Set(),
      username: demo ? "demo-handle" : username,
      configured: demo || Boolean(username),
      loading: !demo,
      error: null,
      source: {
        content: freshness(),
        stats: freshness(),
        progress: freshness(),
      },
      pendingTasks: new Set(),
    },
    listeners: new Set(),
    started: demo,
    lastLoad: 0,
    loadingRequest: null,
    baseTasks: tasks,
    optimisticTasks: new Map(),
    writeQueue: Promise.resolve(),
  };
  stores.set(key, store);
  return store;
}
function publish(store: LearningStore, patch: Partial<LearningData>) {
  store.value = { ...store.value, ...patch };
  for (const listener of store.listeners) listener();
}
function progress(store: LearningStore) {
  const tasks = { ...store.baseTasks };
  for (const [id, done] of store.optimisticTasks) tasks[id] = done;
  publish(store, {
    tasks,
    pendingTasks: new Set(store.optimisticTasks.keys()),
  });
}
async function load(store: LearningStore, demo: boolean): Promise<void> {
  if (demo || store.loadingRequest)
    return store.loadingRequest ?? Promise.resolve();
  store.started = true;
  publish(store, { loading: true, error: null });
  store.loadingRequest = (async () => {
    const results = await Promise.allSettled([
      request<LearningSourceResponse<{ weeks: Week[] }>>(
        "/api/learning/content",
      ),
      request<LearningSourceResponse<LeetCodeStats | null>>(
        "/api/learning/stats",
      ),
      request<LearningSourceResponse<{ tasks: Record<string, boolean> }>>(
        "/api/learning/progress",
      ),
    ]);
    const errors: string[] = [];
    const source = { ...store.value.source };
    const patch: Partial<LearningData> = {};
    const [content, stats, tasks] = results;
    if (content.status === "fulfilled") {
      patch.weeks = content.value.data.weeks;
      source.content = content.value.source;
    } else {
      source.content = { ...source.content, stale: true };
      errors.push("Curriculum could not be refreshed.");
    }
    if (stats.status === "fulfilled") {
      patch.stats = stats.value.data;
      patch.solvedSlugs = stats.value.data
        ? solvedSlugs(buildSolvedByDay(stats.value.data))
        : new Set();
      patch.username = stats.value.username ?? store.value.username;
      patch.configured = stats.value.configured ?? store.value.configured;
      source.stats = stats.value.source;
    } else {
      source.stats = { ...source.stats, stale: true };
      errors.push("LeetCode progress could not be refreshed.");
    }
    if (tasks.status === "fulfilled") {
      store.baseTasks = tasks.value.data.tasks;
      patch.username =
        tasks.value.username ?? patch.username ?? store.value.username;
      patch.configured =
        tasks.value.configured ?? patch.configured ?? store.value.configured;
      source.progress = tasks.value.source;
    } else {
      source.progress = { ...source.progress, stale: true };
      errors.push("Shared task progress could not be refreshed.");
    }
    for (const metadata of Object.values(source))
      if (metadata.stale && metadata.error) errors.push(metadata.error);
    publish(store, {
      ...patch,
      source,
      error: [...new Set(errors)].join(" ") || null,
      loading: false,
    });
    progress(store);
    store.lastLoad = Date.now();
  })().finally(() => {
    store.loadingRequest = null;
  });
  return store.loadingRequest;
}

export function useLearningData() {
  const { mode, user, preferences } = useWorkspace();
  const demo = mode === "demo";
  const username = learningUsername(preferences.leetcode);
  const key = `${mode}:${user?.id ?? "signed-out"}:${username.toLowerCase()}`;
  const store = getStore(key, username, demo);
  const subscribe = useCallback(
    (listener: () => void) => {
      store.listeners.add(listener);
      return () => {
        store.listeners.delete(listener);
      };
    },
    [store],
  );
  const value = useSyncExternalStore(subscribe, () => store.value);
  useEffect(() => {
    if (!user) return;
    if (!store.started) void load(store, demo);
    const refresh = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - store.lastLoad > 60_000 &&
        !store.optimisticTasks.size
      )
        void load(store, demo);
    };
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
    };
  }, [store, demo, user]);
  const reload = useCallback(async () => {
    await store.writeQueue;
    return load(store, demo);
  }, [store, demo]);
  const toggleTask = useCallback(
    async (taskId: string, done: boolean) => {
      if (!store.value.configured || store.optimisticTasks.has(taskId)) return;
      store.optimisticTasks.set(taskId, done);
      progress(store);
      const write = async () => {
        try {
          if (demo) {
            store.baseTasks = { ...store.baseTasks, [taskId]: done };
            try {
              localStorage.setItem(
                "work-demo-learning-tasks",
                JSON.stringify(store.baseTasks),
              );
            } catch {
              /* Optional device persistence. */
            }
          } else {
            const result = await request<
              LearningSourceResponse<{ tasks: Record<string, boolean> }>
            >("/api/learning/progress", jsonRequest("POST", { taskId, done }));
            store.baseTasks = result.data.tasks;
            publish(store, {
              source: { ...store.value.source, progress: result.source },
              error: null,
            });
          }
        } catch (error) {
          publish(store, {
            error:
              error instanceof Error
                ? error.message
                : "Shared task progress could not be saved.",
          });
        } finally {
          store.optimisticTasks.delete(taskId);
          progress(store);
        }
      };
      store.writeQueue = store.writeQueue.then(write, write);
      await store.writeQueue;
    },
    [store, demo],
  );
  return { ...value, reload, toggleTask };
}
