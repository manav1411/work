import type { LeetCodeStats } from "../../../shared/learning";
import { roadmapTopics } from "../../content/problems";
import { DAY_SECONDS, todayAestMidnight } from "./foundations/leetcodeMetrics";

const problems = roadmapTopics.flatMap((topic) => topic.problems).slice(0, 23);
const solvedDays: NonNullable<LeetCodeStats["solvedDays"]> = {};
problems.forEach((problem, index) => {
  const day = String(todayAestMidnight() - Math.floor(index / 2) * DAY_SECONDS);
  (solvedDays[day] ??= []).push({
    title: problem.name,
    titleSlug: problem.slug,
  });
});
// Keep binary search visible as a completed roadmap example.
if (!problems.some((problem) => problem.slug === "binary-search")) {
  solvedDays[String(todayAestMidnight() - 12 * DAY_SECONDS)] = [
    { title: "Binary Search", titleSlug: "binary-search" },
  ];
}
const count = Object.values(solvedDays).flat().length;
const easy =
  problems.filter((problem) => problem.difficulty === "Easy").length +
  (count - problems.length);
const hard = problems.filter((problem) => problem.difficulty === "Hard").length;

export const DEMO_STATS: LeetCodeStats = {
  username: "demo-handle",
  profile: { userAvatar: null, ranking: 184250 },
  solved: [
    { difficulty: "All", count },
    { difficulty: "Easy", count: easy },
    { difficulty: "Medium", count: count - easy - hard },
    { difficulty: "Hard", count: hard },
  ],
  totalQuestions: [],
  calendar: {
    submissions: Object.fromEntries(
      Object.entries(solvedDays).map(([day, entries]) => [
        day,
        entries.length + 1,
      ]),
    ),
  },
  recent: Object.entries(solvedDays).flatMap(([timestamp, entries]) =>
    entries.map((problem) => ({ ...problem, timestamp })),
  ),
  solvedDays,
};
