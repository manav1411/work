import { useCallback, useEffect, useRef, useState } from "react";
import { type Goal, type GoalInput } from "../../shared/goals";
import { request, jsonRequest } from "./api";
import { useWorkspace } from "./workspace";

export function useGoals() {
  const { user, mode } = useWorkspace();
  const scope = `${user?.id ?? ""}:${mode}`;
  const current = useRef(scope);
  current.current = scope;
  const createKeys = useRef(new Map<string, string>());
  const [goals, setGoals] = useState<Goal[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const result = await request<{ goals: Goal[] }>("/api/goals");
      if (current.current === scope) {
        setGoals(result.goals);
        setError("");
      }
    } catch (error) {
      if (current.current === scope)
        setError(
          error instanceof Error ? error.message : "Actions could not load.",
        );
    } finally {
      if (current.current === scope) setLoading(false);
    }
  }, [user, scope]);
  useEffect(() => {
    setGoals([]);
    setLoading(true);
    void refresh();
    const reload = () => void refresh();
    window.addEventListener("focus", reload);
    return () => window.removeEventListener("focus", reload);
  }, [refresh]);
  const put = useCallback(
    (goal: Goal) =>
      setGoals((previous) => {
        const existing = previous.find((item) => item.id === goal.id);
        if (existing && existing.version >= goal.version) return previous;
        return [...previous.filter((item) => item.id !== goal.id), goal].sort(
          (a, b) => a.createdAt.localeCompare(b.createdAt),
        );
      }),
    [],
  );
  const save = async (input: GoalInput, previous?: Goal) => {
    const fingerprint = JSON.stringify(input);
    if (!previous && !createKeys.current.has(fingerprint))
      createKeys.current.set(fingerprint, crypto.randomUUID());
    const result = await request<{ goal: Goal }>(
      previous ? `/api/goals/${previous.id}` : "/api/goals",
      {
        ...jsonRequest(
          previous ? "PATCH" : "POST",
          previous ? { ...input, version: previous.version } : input,
        ),
        ...(!previous
          ? {
              headers: {
                "Idempotency-Key": createKeys.current.get(fingerprint)!,
              },
            }
          : {}),
      },
    );
    createKeys.current.delete(fingerprint);
    put(result.goal);
    return result.goal;
  };
  const remove = async (goal: Goal) => {
    await request(`/api/goals/${goal.id}`, { method: "DELETE" });
    setGoals((previous) => previous.filter((item) => item.id !== goal.id));
  };
  return { goals, loading, error, refresh, save, remove };
}
