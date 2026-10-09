import type { Goal } from "../../../shared/goals";
import { roadmapTopics } from "../../content/problems";
import type { useLearningData } from "../learn/useLearningData";

const neetcode150Problems = roadmapTopics.flatMap((topic) => topic.problems);

export function observedProgress(
  goal: Goal,
  learning: ReturnType<typeof useLearningData>,
): number | undefined {
  if (!learning.configured || !learning.stats) return undefined;
  if (goal.measure === "leetcode")
    return learning.stats.solved.find((item) => item.difficulty === "All")
      ?.count;
  if (goal.measure === "neetcode150")
    return neetcode150Problems.filter((problem) =>
      learning.solvedSlugs.has(problem.slug),
    ).length;
}
