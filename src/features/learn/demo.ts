import type { LeetCodeStats, Week } from "../../../shared/learning";
import { CURRICULUM_WEEKS } from "./foundations/curriculumWeeks";
import { roadmapTopics } from "./foundations/roadmapData";

// Deliberately synthetic content and progress: demo never requests the owner's
// public profile or learning-task endpoint.
export const DEMO_WEEKS: Week[] = CURRICULUM_WEEKS.map((seed, index) => ({
  ...seed,
  accessible: index < 2,
  slides:
    index < 2
      ? [
          { content: `# ${seed.title}\n\nDemo slide deck.` },
          {
            content:
              "## Binary search\n\nKeep the search interval explicit. Each step removes half of the remaining candidates.\n\n```python\nwhile left <= right:\n    mid = (left + right) // 2\n```",
          },
          {
            content:
              "## Complexity\n\n| Operation | Cost |\n| --- | --- |\n| Binary search | O(log n) |\n| Dictionary lookup | O(1) average |",
          },
        ]
      : [],
  topic2SlideStart: 2,
  topics: [
    {
      homework:
        index < 2
          ? roadmapTopics[index === 0 ? 3 : 1].problems.slice(0, 3)
          : [],
    },
    { homework: [] },
  ],
  tasks:
    index === 0
      ? [{ id: "demo-python-tools", label: "Run a Python solution locally" }]
      : [],
}));

export const DEMO_STATS: LeetCodeStats = {
  username: "demo-handle",
  profile: { userAvatar: null, ranking: null },
  solved: [
    { difficulty: "All", count: 23 },
    { difficulty: "Easy", count: 12 },
    { difficulty: "Medium", count: 10 },
    { difficulty: "Hard", count: 1 },
  ],
  totalQuestions: [],
  calendar: { submissions: {} },
  recent: [],
  solvedDays: {
    "1785456000": [
      { title: "Binary Search", titleSlug: "binary-search" },
      { title: "Two Sum", titleSlug: "two-sum" },
    ],
  },
};
