// Static 12-week DSA curriculum titles used to seed / pad learn content in KV.
// Slides and homework stay empty here — content is filled via /admin over time.

export const CURRICULUM_WEEK_COUNT = 12;

export interface CurriculumWeekSeed {
  week: number;
  accessible: boolean;
  /** Card title shown on the Learn board. */
  title: string;
}

export const CURRICULUM_WEEKS: CurriculumWeekSeed[] = [
  {
    week: 1,
    accessible: true,
    title: "Python for DSA & Binary Search",
  },
  {
    week: 2,
    accessible: false,
    title: "Two Pointers, Sliding Window & Prefix Sums",
  },
  {
    week: 3,
    accessible: false,
    title: "Stacks & Queues (+ Monotonic Stack)",
  },
  {
    week: 4,
    accessible: false,
    title: "Sorting, Intervals & Recursion",
  },
  {
    week: 5,
    accessible: false,
    title: "Linked Lists & Trees (DFS)",
  },
  {
    week: 6,
    accessible: false,
    title: "Trees (BFS/BST) & Heaps",
  },
  {
    week: 7,
    accessible: false,
    title: "Graphs I (Traversal)",
  },
  {
    week: 8,
    accessible: false,
    title: "Backtracking & Divide-and-Conquer",
  },
  {
    week: 9,
    accessible: false,
    title: "Greedy & Graphs II",
  },
  {
    week: 10,
    accessible: false,
    title: "Dynamic Programming (1D & 2D)",
  },
  {
    week: 11,
    accessible: false,
    title: "Advanced",
  },
  {
    week: 12,
    accessible: false,
    title: "Mixed & Timed Drills",
  },
];
