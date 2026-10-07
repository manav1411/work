import type { Goal } from "../../../shared/goals";
import type { useLearningData } from "../learn/useLearningData";

export function observedProgress(
  goal: Goal,
  learning: ReturnType<typeof useLearningData>,
): number | undefined {
  if (!learning.configured || !learning.stats) return undefined;
  if (goal.measure === "leetcode")
    return learning.stats.solved.find((item) => item.difficulty === "All")
      ?.count;
}
