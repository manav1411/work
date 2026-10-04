import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  learningUsername,
  type LearningFreshness,
  type LearningSourceResponse,
  type LeetCodeStats,
  type Week,
} from "../../../shared/learning";
import { request } from "../../lib/api";
import { useWorkspace } from "../../lib/workspace";
import { DEMO_STATS } from "./demo";
import { buildSolvedByDay, solvedSlugs } from "./foundations/leetcodeMetrics";

export interface LearningData {
  stats: LeetCodeStats | null;
  solvedSlugs: Set<string>;
  username: string;
  configured: boolean;
  loading: boolean;
  error: string | null;
  source: Record<"content" | "stats" | "progress", LearningFreshness>;
  /** Retired curriculum remains separate from roadmap statistics. */
  weeks: Week[];
  tasks: Record<string, boolean>;
  pendingTasks: Set<string>;
}
interface LearningStore {
  value: LearningData;
  listeners: Set<() => void>;
  started: boolean;
  lastLoad: number;
  loadingRequest: Promise<void> | null;
}
const stores = new Map<string, LearningStore>();
const freshness = (): LearningFreshness => ({ fetchedAt: null, stale: false });
export async function loadRoadmapStatistics(
  read: (
    path: string,
  ) => Promise<LearningSourceResponse<LeetCodeStats | null>> = request,
) {
  return read("/api/learning/stats");
}
function getStore(key: string, username: string, demo: boolean): LearningStore {
  const previous = stores.get(key);
  if (previous) return previous;
  const stats = demo ? DEMO_STATS : null;
  const store: LearningStore = {
    value: {
      stats,
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
      weeks: [],
      tasks: {},
      pendingTasks: new Set(),
    },
    listeners: new Set(),
    started: demo,
    lastLoad: 0,
    loadingRequest: null,
  };
  stores.set(key, store);
  return store;
}
function publish(store: LearningStore, patch: Partial<LearningData>) {
  store.value = { ...store.value, ...patch };
  for (const listener of store.listeners) listener();
}
async function load(store: LearningStore, demo: boolean): Promise<void> {
  if (demo || store.loadingRequest)
    return store.loadingRequest ?? Promise.resolve();
  store.started = true;
  publish(store, { loading: true, error: null });
  store.loadingRequest = (async () => {
    try {
      const response = await loadRoadmapStatistics();
      publish(store, {
        stats: response.data,
        solvedSlugs: response.data
          ? solvedSlugs(buildSolvedByDay(response.data))
          : new Set(),
        username: response.username ?? store.value.username,
        configured: response.configured ?? store.value.configured,
        source: { ...store.value.source, stats: response.source },
        error: response.source.stale
          ? (response.source.error ?? "Showing cached LeetCode progress.")
          : null,
        loading: false,
      });
    } catch (failure) {
      publish(store, {
        source: {
          ...store.value.source,
          stats: { ...store.value.source.stats, stale: true },
        },
        error:
          failure instanceof Error
            ? failure.message
            : "LeetCode progress could not be refreshed.",
        loading: false,
      });
    } finally {
      store.lastLoad = Date.now();
    }
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
        Date.now() - store.lastLoad > 60_000
      )
        void load(store, demo);
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [store, demo, user]);
  const reload = useCallback(() => load(store, demo), [store, demo]);
  return { ...value, reload };
}
