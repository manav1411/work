import { useEffect, useRef } from "react";
import type { Goal } from "../../../shared/goals";
import type { useLearningData } from "../learn/useLearningData";
import type { useGoals } from "../../lib/goals";
import { roadmapTopics } from "../../content/problems";

export function observedProgress(
  goal: Goal,
  learning: ReturnType<typeof useLearningData>,
): number | undefined {
  if (!learning.configured || !learning.stats) return undefined;
  if (goal.measure === "leetcode")
    return learning.stats.solved.find((item) => item.difficulty === "All")
      ?.count;
  if (goal.measure === "problems") {
    const slugs = new Set(
      roadmapTopics
        .filter((topic) => !goal.scope || topic.id === goal.scope)
        .flatMap((topic) => topic.problems.map((problem) => problem.slug)),
    );
    return [...learning.solvedSlugs].filter((slug) => slugs.has(slug)).length;
  }
}
export function useGoalMeasurements(
  model: ReturnType<typeof useGoals>,
  learning: ReturnType<typeof useLearningData>,
  owner: string,
) {
  const attempts = useRef(new Set<string>());
  useEffect(() => {
    const source = learning.source.stats;
    if (!source.fetchedAt || source.stale) return;
    for (const goal of model.goals) {
      const value = observedProgress(goal, learning);
      if (
        value === undefined ||
        goal.value === value ||
        goal.status === "completed"
      )
        continue;
      const key = `${owner}:${goal.id}:${goal.measure}:${goal.scope}:${source.fetchedAt}:${value}`;
      if (attempts.current.has(key)) continue;
      attempts.current.add(key);
      void model
        .checkpoint(goal, value, source.fetchedAt)
        .catch(() => void model.refresh());
    }
  }, [model.goals, model.checkpoint, model.refresh, learning, owner]);
}
